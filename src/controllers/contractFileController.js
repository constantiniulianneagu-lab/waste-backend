// src/controllers/contractFileController.js
/**
 * ============================================================================
 * CONTRACT FILE UPLOAD CONTROLLER - GENERIC FOR ALL CONTRACT TYPES
 * ============================================================================
 * Upload, download și ștergere contracte PDF în Supabase Storage
 * Funcționează pentru: TMB, Waste Operator, Sorting, Disposal
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import multer from 'multer';

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Contract type mappings
const CONTRACT_TYPE_MAPPINGS = {
  'tmb': {
    table: 'tmb_contracts',
    bucket: 'tmb-contracts'
  },
  'waste': {
    table: 'waste_operator_contracts',
    bucket: 'waste-operator-contracts'
  },
  'sorting': {
    table: 'sorting_operator_contracts',
    bucket: 'sorting-contracts'
  },
  'disposal': {
    table: 'disposal_contracts',
    bucket: 'disposal-contracts'
  }
};

// Multer configuration pentru file upload
const storage = multer.memoryStorage();
export const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Doar fișiere PDF sunt acceptate'), false);
    }
  },
});

// ============================================================================
// HELPER: Get contract type config
// ============================================================================

const getContractTypeConfig = (contractType) => {
  const config = CONTRACT_TYPE_MAPPINGS[contractType];
  if (!config) {
    throw new Error(`Invalid contract type: ${contractType}. Valid types: ${Object.keys(CONTRACT_TYPE_MAPPINGS).join(', ')}`);
  }
  return config;
};

// ============================================================================
// UPLOAD CONTRACT FILE
// ============================================================================

export const uploadContractFile = async (req, res) => {
  try {
    const { contractType, contractId } = req.params;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'Niciun fișier selectat',
      });
    }
    
    // Get contract type configuration
    let config;
    try {
      config = getContractTypeConfig(contractType);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileName = `${contractId}_${timestamp}.pdf`;
    const filePath = `contracts/${fileName}`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(config.bucket)
      .upload(filePath, file.buffer, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: false,
      });
    
    if (error) {
      console.error('Supabase upload error:', error);
      return res.status(500).json({
        success: false,
        message: 'Eroare la încărcarea fișierului în storage',
        error: error.message,
      });
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from(config.bucket)
      .getPublicUrl(filePath);
    
    // Update contract record in database
    const { data: updateData, error: updateError } = await supabase
      .from(config.table)
      .update({
        contract_file_url: urlData.publicUrl,
        contract_file_name: file.originalname,
        contract_file_size: file.size,
        contract_file_type: file.mimetype,
        contract_file_uploaded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .select()
      .single();
    
    if (updateError) {
      // Rollback: delete uploaded file
      await supabase.storage
        .from(config.bucket)
        .remove([filePath]);
      
      return res.status(500).json({
        success: false,
        message: 'Eroare la actualizarea contractului',
        error: updateError.message,
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Fișier încărcat cu succes',
      data: {
        url: urlData.publicUrl,
        name: file.originalname,
        size: file.size,
        uploadedAt: new Date().toISOString(),
      },
    });
    
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la încărcarea fișierului',
      error: err.message,
    });
  }
};

// ============================================================================
// DELETE CONTRACT FILE
// ============================================================================

export const deleteContractFile = async (req, res) => {
  try {
    const { contractType, contractId } = req.params;
    
    // Get contract type configuration
    let config;
    try {
      config = getContractTypeConfig(contractType);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    // Get contract to find file path
    const { data: contract, error: fetchError } = await supabase
      .from(config.table)
      .select('contract_file_url')
      .eq('id', contractId)
      .single();
    
    if (fetchError || !contract) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit',
      });
    }
    
    if (!contract.contract_file_url) {
      return res.status(400).json({
        success: false,
        message: 'Contractul nu are fișier atașat',
      });
    }
    
    // Extract file path from URL
    const url = new URL(contract.contract_file_url);
    const filePath = url.pathname.split('/').slice(-2).join('/'); // contracts/filename.pdf
    
    // Delete from storage
    const { error: deleteError } = await supabase.storage
      .from(config.bucket)
      .remove([filePath]);
    
    if (deleteError) {
      console.error('Storage delete error:', deleteError);
    }
    
    // Update contract record (remove file info)
    const { error: updateError } = await supabase
      .from(config.table)
      .update({
        contract_file_url: null,
        contract_file_name: null,
        contract_file_size: null,
        contract_file_type: null,
        contract_file_uploaded_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId);
    
    if (updateError) {
      return res.status(500).json({
        success: false,
        message: 'Eroare la actualizarea contractului',
        error: updateError.message,
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Fișier șters cu succes',
    });
    
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la ștergerea fișierului',
      error: err.message,
    });
  }
};

// ============================================================================
// GET CONTRACT FILE INFO
// ============================================================================

export const getContractFileInfo = async (req, res) => {
  try {
    const { contractType, contractId } = req.params;
    
    // Get contract type configuration
    let config;
    try {
      config = getContractTypeConfig(contractType);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    
    const { data: contract, error } = await supabase
      .from(config.table)
      .select('contract_file_url, contract_file_name, contract_file_size, contract_file_uploaded_at')
      .eq('id', contractId)
      .single();
    
    if (error) {
      return res.status(404).json({
        success: false,
        message: 'Contract negăsit',
      });
    }
    
    if (!contract.contract_file_url) {
      return res.status(200).json({
        success: true,
        data: null,
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        url: contract.contract_file_url,
        name: contract.contract_file_name,
        size: contract.contract_file_size,
        uploadedAt: contract.contract_file_uploaded_at,
      },
    });
    
  } catch (err) {
    console.error('Get file info error:', err);
    res.status(500).json({
      success: false,
      message: 'Eroare la obținerea informațiilor despre fișier',
      error: err.message,
    });
  }
};