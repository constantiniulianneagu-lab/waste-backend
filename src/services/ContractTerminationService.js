// ============================================================================
// CONTRACT TERMINATION SERVICE
// ============================================================================
// Serviciu pentru detectarea și închiderea automată a contractelor suprapuse
// Author: Claude + Kos
// Date: 1 Februarie 2026
// ============================================================================

const pool = require('../config/database');
const { calculateProportionalQuantity } = require('../utils/QuantityCalculationHelper');

class ContractTerminationService {
  
  /**
   * Mapare între tipuri de contract și tabelele lor
   */
  static CONTRACT_TABLES = {
    DISPOSAL: 'disposal_contracts',
    TMB: 'tmb_contracts',
    AEROBIC: 'aerobic_contracts',
    ANAEROBIC: 'anaerobic_contracts',
    WASTE_COLLECTOR: 'waste_collector_contracts',
    SORTING: 'sorting_operator_contracts'
  };

  static AMENDMENT_TABLES = {
    DISPOSAL: 'disposal_contract_amendments',
    TMB: 'tmb_contract_amendments',
    AEROBIC: 'aerobic_contract_amendments',
    ANAEROBIC: 'anaerobic_contract_amendments',
    WASTE_COLLECTOR: 'waste_collector_contract_amendments',
    SORTING: 'sorting_operator_contract_amendments'
  };

  /**
   * Găsește contracte active suprapuse pe același sector și tip
   * 
   * @param {string} contractType - Tipul contractului (DISPOSAL, TMB, etc.)
   * @param {string|null} sectorId - UUID-ul sectorului
   * @param {Date} serviceStartDate - Data începerii prestării pentru noul contract
   * @param {number} excludeContractId - ID-ul contractului de exclus (noul contract)
   * @returns {Promise<Array>} Lista contractelor care vor fi închise automat
   */
  static async findOverlappingContracts(contractType, sectorId, serviceStartDate, excludeContractId) {
    if (!serviceStartDate) {
      return []; // Dacă nu e service_start_date, nu facem nimic
    }

    const tableName = this.CONTRACT_TABLES[contractType];
    const amendmentTable = this.AMENDMENT_TABLES[contractType];

    if (!tableName) {
      throw new Error(`Tip contract invalid: ${contractType}`);
    }

    try {
      // Query pentru găsirea contractelor active suprapuse
      const query = `
        SELECT 
          c.*,
          COALESCE(
            (SELECT new_contract_date_end 
             FROM ${amendmentTable} 
             WHERE contract_id = c.id AND deleted_at IS NULL 
             ORDER BY amendment_date DESC LIMIT 1),
            c.contract_date_end
          ) as effective_date_end
        FROM ${tableName} c
        WHERE c.deleted_at IS NULL
          AND c.is_active = true
          AND c.id != $1
          ${sectorId ? 'AND c.sector_id = $2' : ''}
          AND COALESCE(
            (SELECT new_contract_date_end 
             FROM ${amendmentTable} 
             WHERE contract_id = c.id AND deleted_at IS NULL 
             ORDER BY amendment_date DESC LIMIT 1),
            c.contract_date_end
          ) > $3
      `;

      const params = sectorId 
        ? [excludeContractId, sectorId, serviceStartDate]
        : [excludeContractId, serviceStartDate];

      const result = await pool.query(query, params);
      return result.rows;

    } catch (error) {
      console.error('Error finding overlapping contracts:', error);
      throw error;
    }
  }

  /**
   * Generează număr unic pentru act adițional automat
   * 
   * @param {string} contractNumber - Numărul contractului
   * @returns {string} Număr act adițional (ex: D-244-AUTO-3)
   */
  static async generateAutomaticAmendmentNumber(contractType, contractId, contractNumber) {
    const amendmentTable = this.AMENDMENT_TABLES[contractType];

    try {
      // Numără câte acte adiționale automate există deja
      const countQuery = `
        SELECT COUNT(*) as count
        FROM ${amendmentTable}
        WHERE contract_id = $1
          AND amendment_type = 'AUTO_TERMINATION'
          AND deleted_at IS NULL
      `;
      
      const result = await pool.query(countQuery, [contractId]);
      const autoCount = parseInt(result.rows[0].count) + 1;

      return `${contractNumber}-AUTO-${autoCount}`;

    } catch (error) {
      // Fallback: folosește timestamp
      const timestamp = Date.now();
      return `${contractNumber}-AUTO-${timestamp}`;
    }
  }

  /**
   * Creează act adițional automat de încetare
   * 
   * @param {string} contractType - Tipul contractului vechi
   * @param {Object} oldContract - Contractul care se închide
   * @param {Object} newContract - Contractul nou care preia serviciul
   * @param {number} userId - ID-ul utilizatorului care creează noul contract
   * @returns {Promise<Object>} Actul adițional creat
   */
  static async createAutomaticTerminationAmendment(contractType, oldContract, newContract, userId) {
    const amendmentTable = this.AMENDMENT_TABLES[contractType];
    
    try {
      // Generează număr act adițional
      const amendmentNumber = await this.generateAutomaticAmendmentNumber(
        contractType,
        oldContract.id,
        oldContract.contract_number
      );

      // Calculează cantitatea ajustată proporțional
      let quantityAdjustmentAuto = null;
      
      if (oldContract.estimated_quantity_tons || oldContract.contracted_quantity_tons) {
        const totalQuantity = oldContract.estimated_quantity_tons || oldContract.contracted_quantity_tons;
        
        try {
          const calculation = calculateProportionalQuantity(
            totalQuantity,
            oldContract.contract_date_start,
            oldContract.effective_date_end || oldContract.contract_date_end,
            newContract.service_start_date
          );
          
          quantityAdjustmentAuto = calculation.adjustedQuantity;
        } catch (calcError) {
          console.warn('Could not calculate proportional quantity:', calcError.message);
          // Continuăm fără cantitate ajustată
        }
      }

      // Creează act adițional
      const insertQuery = `
        INSERT INTO ${amendmentTable} (
          contract_id,
          amendment_number,
          amendment_date,
          amendment_type,
          new_contract_date_end,
          quantity_adjustment_auto,
          reference_contract_id,
          notes,
          created_by,
          created_at,
          updated_at
        ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING *
      `;

      const notes = `Încetare automată - serviciul preluat de contractul ${newContract.contract_number} cu începere efectivă la ${new Date(newContract.service_start_date).toLocaleDateString('ro-RO')}`;

      const params = [
        oldContract.id,
        amendmentNumber,
        'AUTO_TERMINATION',
        newContract.service_start_date,
        quantityAdjustmentAuto,
        newContract.id,
        notes,
        userId
      ];

      const result = await pool.query(insertQuery, params);
      
      return {
        success: true,
        amendment: result.rows[0],
        oldContract: {
          id: oldContract.id,
          contract_number: oldContract.contract_number,
          new_end_date: newContract.service_start_date
        },
        calculation: quantityAdjustmentAuto ? {
          original_quantity: oldContract.estimated_quantity_tons || oldContract.contracted_quantity_tons,
          adjusted_quantity: quantityAdjustmentAuto
        } : null
      };

    } catch (error) {
      console.error('Error creating automatic termination amendment:', error);
      throw error;
    }
  }

  /**
   * Procesează închiderea automată a contractelor la crearea unui contract nou
   * 
   * @param {string} contractType - Tipul contractului nou
   * @param {Object} newContract - Datele contractului nou (inclusiv service_start_date)
   * @param {number} userId - ID-ul utilizatorului
   * @returns {Promise<Object>} Rezultatul procesării
   */
  static async processAutomaticTerminations(contractType, newContract, userId) {
    // Verifică dacă are service_start_date
    if (!newContract.service_start_date) {
      return {
        terminated: [],
        message: 'Nu există service_start_date, nu se efectuează închideri automate'
      };
    }

    try {
      // Găsește contracte suprapuse
      const overlappingContracts = await this.findOverlappingContracts(
        contractType,
        newContract.sector_id,
        newContract.service_start_date,
        newContract.id
      );

      if (overlappingContracts.length === 0) {
        return {
          terminated: [],
          message: 'Nu există contracte suprapuse de închis'
        };
      }

      // Creează acte adiționale pentru fiecare contract suprapus
      const results = [];
      
      for (const oldContract of overlappingContracts) {
        try {
          const amendmentResult = await this.createAutomaticTerminationAmendment(
            contractType,
            oldContract,
            newContract,
            userId
          );
          
          results.push(amendmentResult);
          
        } catch (error) {
          console.error(`Failed to terminate contract ${oldContract.contract_number}:`, error);
          results.push({
            success: false,
            oldContract: {
              id: oldContract.id,
              contract_number: oldContract.contract_number
            },
            error: error.message
          });
        }
      }

      return {
        terminated: results,
        message: `${results.filter(r => r.success).length} contracte închise automat`
      };

    } catch (error) {
      console.error('Error processing automatic terminations:', error);
      throw error;
    }
  }

  /**
   * Obține lista actelor adiționale automate pentru un contract
   * 
   * @param {string} contractType - Tipul contractului
   * @param {number} contractId - ID-ul contractului
   * @returns {Promise<Array>} Lista actelor adiționale automate
   */
  static async getAutomaticTerminations(contractType, contractId) {
    const amendmentTable = this.AMENDMENT_TABLES[contractType];

    try {
      const query = `
        SELECT a.*, c.contract_number as reference_contract_number
        FROM ${amendmentTable} a
        LEFT JOIN ${this.CONTRACT_TABLES[contractType]} c ON a.reference_contract_id = c.id
        WHERE a.contract_id = $1
          AND a.amendment_type = 'AUTO_TERMINATION'
          AND a.deleted_at IS NULL
        ORDER BY a.amendment_date DESC
      `;

      const result = await pool.query(query, [contractId]);
      return result.rows;

    } catch (error) {
      console.error('Error getting automatic terminations:', error);
      throw error;
    }
  }
}

module.exports = ContractTerminationService;