// src/utils/supabaseStorage.js
/**
 * ============================================================================
 * SUPABASE STORAGE UTILITY
 * ============================================================================
 * Upload, delete, and get URLs for contract PDFs
 * ============================================================================
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://exrfdqrvpdsptihjkift.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Bucket names based on contract type
const BUCKETS = {
  DISPOSAL: 'disposal-contracts',
  TMB: 'tmb-contracts',
  SORTING: 'sorting-contracts',
  WASTE_COLLECTOR: 'waste-operator-contracts',
};

/**
 * Upload a PDF file to Supabase Storage
 * @param {File} file - The PDF file to upload
 * @param {string} contractType - DISPOSAL, TMB, etc.
 * @param {string} contractNumber - Contract number for naming
 * @param {boolean} isAmendment - If true, it's an amendment file
 * @param {string} amendmentNumber - Amendment number (if applicable)
 * @returns {Promise<{success: boolean, url?: string, fileName?: string, error?: string}>}
 */
export const uploadContractPDF = async (file, contractType, contractNumber, isAmendment = false, amendmentNumber = null) => {
  try {
    // Validate file type
    if (file.type !== 'application/pdf') {
      return { success: false, error: 'Doar fișiere PDF sunt acceptate' };
    }

    // Validate file size (max 20MB)
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) {
      return { success: false, error: 'Fișierul depășește limita de 20MB' };
    }

    const bucket = BUCKETS[contractType] || BUCKETS.DISPOSAL;
    
    // Generate file name
    const timestamp = Date.now();
    const sanitizedContractNumber = contractNumber.replace(/[^a-zA-Z0-9-]/g, '_');
    let fileName;
    
    if (isAmendment && amendmentNumber) {
      const sanitizedAmendmentNumber = amendmentNumber.replace(/[^a-zA-Z0-9-]/g, '_');
      fileName = `amendments/${sanitizedContractNumber}/${sanitizedAmendmentNumber}-${timestamp}.pdf`;
    } else {
      fileName = `contracts/${sanitizedContractNumber}-${timestamp}.pdf`;
    }

    // Upload to Supabase
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      return { success: false, error: error.message };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(fileName);

    return {
      success: true,
      url: urlData.publicUrl,
      fileName: file.name,
      storagePath: fileName,
    };
  } catch (err) {
    console.error('Upload error:', err);
    return { success: false, error: 'Eroare la încărcarea fișierului' };
  }
};

/**
 * Delete a PDF file from Supabase Storage
 * @param {string} fileUrl - The full URL of the file
 * @param {string} contractType - DISPOSAL, TMB, etc.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const deleteContractPDF = async (fileUrl, contractType) => {
  try {
    const bucket = BUCKETS[contractType] || BUCKETS.DISPOSAL;
    
    // Extract file path from URL
    const urlParts = fileUrl.split(`/storage/v1/object/public/${bucket}/`);
    if (urlParts.length < 2) {
      return { success: false, error: 'URL invalid' };
    }
    
    const filePath = urlParts[1];

    const { error } = await supabase.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      console.error('Delete error:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Delete error:', err);
    return { success: false, error: 'Eroare la ștergerea fișierului' };
  }
};

/**
 * Get the public URL for a file
 * @param {string} filePath - The storage path
 * @param {string} contractType - DISPOSAL, TMB, etc.
 * @returns {string}
 */
export const getPublicUrl = (filePath, contractType) => {
  const bucket = BUCKETS[contractType] || BUCKETS.DISPOSAL;
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
};

export default supabase;