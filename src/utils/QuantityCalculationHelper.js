// ============================================================================
// QUANTITY CALCULATION HELPER
// ============================================================================
// Funcții pentru calculul cantităților proporționale în acte adiționale
// Author: Claude + Kos
// Date: 1 Februarie 2026
// ============================================================================

/**
 * Calculează numărul de zile între două date
 * @param {Date|string} startDate - Data de început
 * @param {Date|string} endDate - Data de sfârșit
 * @returns {number} Numărul de zile (inclusiv)
 */
const calculateDaysBetween = (startDate, endDate) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    // Calculează diferența în milisecunde
    const diffTime = Math.abs(end - start);
    
    // Convertește în zile și adaugă 1 (pentru a include și ziua de start)
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    return diffDays;
  };
  
  /**
   * Verifică dacă un an este bisect
   * @param {number} year - Anul
   * @returns {boolean}
   */
  const isLeapYear = (year) => {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  };
  
  /**
   * Calculează cantitatea proporțională bazată pe zile
   * 
   * @param {number} totalQuantity - Cantitatea totală din contract (tone)
   * @param {Date|string} contractStart - Data de început contract
   * @param {Date|string} contractEnd - Data de sfârșit contract (original)
   * @param {Date|string} newEnd - Noua dată de sfârșit (prelungire/încetare)
   * @returns {Object} { adjustedQuantity, additionalQuantity, daysOriginal, daysNew, tonsPerDay }
   * 
   * @example
   * // Prelungire cu 50 zile
   * calculateProportionalQuantity(100000, '2024-01-01', '2024-12-31', '2025-02-19')
   * // Returns: { 
   * //   adjustedQuantity: 113698.63,
   * //   additionalQuantity: 13698.63,
   * //   daysOriginal: 366,
   * //   daysNew: 416,
   * //   tonsPerDay: 273.97
   * // }
   * 
   * @example
   * // Încetare după 5 luni (152 zile)
   * calculateProportionalQuantity(100000, '2024-01-01', '2024-12-31', '2024-06-01')
   * // Returns: {
   * //   adjustedQuantity: 41643.84,
   * //   additionalQuantity: -58356.16,
   * //   daysOriginal: 366,
   * //   daysNew: 152,
   * //   tonsPerDay: 273.97
   * // }
   */
  const calculateProportionalQuantity = (totalQuantity, contractStart, contractEnd, newEnd) => {
    // Validare input
    if (!totalQuantity || totalQuantity <= 0) {
      throw new Error('Cantitatea totală trebuie să fie mai mare ca 0');
    }
    
    if (!contractStart || !contractEnd || !newEnd) {
      throw new Error('Toate datele sunt obligatorii');
    }
  
    // Convertește în Date objects
    const start = new Date(contractStart);
    const originalEnd = new Date(contractEnd);
    const adjustedEnd = new Date(newEnd);
  
    // Validare date
    if (adjustedEnd < start) {
      throw new Error('Data nouă nu poate fi înainte de data de început a contractului');
    }
  
    // Calculează zilele în contract original
    const daysOriginal = calculateDaysBetween(start, originalEnd);
    
    // Calculează zilele până la noua dată
    const daysNew = calculateDaysBetween(start, adjustedEnd);
    
    // Calculează tone pe zi
    const tonsPerDay = totalQuantity / daysOriginal;
    
    // Calculează cantitatea ajustată
    const adjustedQuantity = tonsPerDay * daysNew;
    
    // Calculează cantitatea adițională (pozitivă pentru prelungire, negativă pentru încetare)
    const additionalQuantity = adjustedQuantity - totalQuantity;
  
    return {
      adjustedQuantity: Math.round(adjustedQuantity * 100) / 100, // 2 decimale
      additionalQuantity: Math.round(additionalQuantity * 100) / 100,
      daysOriginal,
      daysNew,
      tonsPerDay: Math.round(tonsPerDay * 100) / 100,
      isProlongation: daysNew > daysOriginal,
      isTermination: daysNew < daysOriginal
    };
  };
  
  /**
   * Calculează valoarea pentru contracte DISPOSAL (tarif + CEC)
   * 
   * @param {number} quantity - Cantitatea în tone
   * @param {number} tariffPerTon - Tariful pe tonă
   * @param {number} cecTaxPerTon - Taxa CEC pe tonă (opțional)
   * @returns {Object} { tariffValue, cecValue, totalValue }
   * 
   * @example
   * calculateDisposalValue(100, 500, 160)
   * // Returns: {
   * //   tariffValue: 50000.00,
   * //   cecValue: 16000.00,
   * //   totalValue: 66000.00
   * // }
   */
  const calculateDisposalValue = (quantity, tariffPerTon, cecTaxPerTon = 0) => {
    if (!quantity || quantity <= 0) {
      throw new Error('Cantitatea trebuie să fie mai mare ca 0');
    }
  
    if (!tariffPerTon || tariffPerTon < 0) {
      throw new Error('Tariful trebuie să fie mai mare sau egal cu 0');
    }
  
    const tariffValue = quantity * tariffPerTon;
    const cecValue = quantity * (cecTaxPerTon || 0);
    const totalValue = tariffValue + cecValue;
  
    return {
      tariffValue: Math.round(tariffValue * 100) / 100,
      cecValue: Math.round(cecValue * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100
    };
  };
  
  /**
   * Calculează valoarea pentru contracte cu tarif simplu (TMB, AEROBIC, ANAEROBIC, SORTING)
   * 
   * @param {number} quantity - Cantitatea în tone
   * @param {number} tariffPerTon - Tariful pe tonă
   * @returns {number} Valoarea totală
   */
  const calculateSimpleValue = (quantity, tariffPerTon) => {
    if (!quantity || quantity <= 0) {
      throw new Error('Cantitatea trebuie să fie mai mare ca 0');
    }
  
    if (!tariffPerTon || tariffPerTon < 0) {
      throw new Error('Tariful trebuie să fie mai mare sau egal cu 0');
    }
  
    const totalValue = quantity * tariffPerTon;
    return Math.round(totalValue * 100) / 100;
  };
  
  /**
   * Calculează diferența de valoare între cantități (pentru acte adiționale)
   * 
   * @param {number} oldQuantity - Cantitatea veche
   * @param {number} newQuantity - Cantitatea nouă
   * @param {number} tariffPerTon - Tariful pe tonă
   * @param {number} cecTaxPerTon - Taxa CEC (opțional, pentru DISPOSAL)
   * @returns {Object} { oldValue, newValue, valueDifference }
   */
  const calculateValueDifference = (oldQuantity, newQuantity, tariffPerTon, cecTaxPerTon = 0) => {
    const totalTariff = tariffPerTon + (cecTaxPerTon || 0);
    
    const oldValue = oldQuantity * totalTariff;
    const newValue = newQuantity * totalTariff;
    const valueDifference = newValue - oldValue;
  
    return {
      oldValue: Math.round(oldValue * 100) / 100,
      newValue: Math.round(newValue * 100) / 100,
      valueDifference: Math.round(valueDifference * 100) / 100,
      isIncrease: valueDifference > 0,
      isDecrease: valueDifference < 0
    };
  };
  
  /**
   * Formatează rezultatul calculului pentru afișare în UI
   * 
   * @param {Object} calculation - Rezultatul din calculateProportionalQuantity
   * @returns {string} Text formatat pentru afișare
   */
  const formatCalculationSummary = (calculation) => {
    const { adjustedQuantity, additionalQuantity, daysOriginal, daysNew, tonsPerDay, isProlongation } = calculation;
    
    if (isProlongation) {
      return `Prelungire cu ${daysNew - daysOriginal} zile: ${tonsPerDay} t/zi × ${daysNew - daysOriginal} zile = +${Math.abs(additionalQuantity).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} tone. Total: ${adjustedQuantity.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} tone`;
    } else {
      return `Încetare după ${daysNew} zile: ${tonsPerDay} t/zi × ${daysNew} zile = ${adjustedQuantity.toLocaleString('ro-RO', { minimumFractionDigits: 2 })} tone (${Math.abs(additionalQuantity).toLocaleString('ro-RO', { minimumFractionDigits: 2 })} tone mai puțin)`;
    }
  };
  
  module.exports = {
    calculateDaysBetween,
    isLeapYear,
    calculateProportionalQuantity,
    calculateDisposalValue,
    calculateSimpleValue,
    calculateValueDifference,
    formatCalculationSummary
  };