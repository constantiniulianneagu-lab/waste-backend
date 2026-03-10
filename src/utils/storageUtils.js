// src/utils/storageUtils.js
/**
 * Utilitar pentru ștergerea fișierelor din Supabase Storage.
 * Folosit la ștergerea contractelor și actelor adiționale.
 */

import { createClient } from '@supabase/supabase-js';

let _supabase = null;
const getSupabase = () => {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );
  }
  return _supabase;
};

/**
 * Extrage calea relativă din URL-ul Supabase Storage.
 * Ex: https://xxx.supabase.co/storage/v1/object/public/tmb-contracts/contracts/file.pdf
 *     → contracts/file.pdf
 */
const extractFilePath = (url) => {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    // ultimele 2 segmente: folder/filename.pdf
    return parts.slice(-2).join('/');
  } catch {
    return null;
  }
};

/**
 * Șterge un fișier din Supabase Storage.
 * Nu aruncă eroare dacă fișierul nu există — loghează doar.
 *
 * @param {string} bucket  - numele bucket-ului (ex: 'tmb-contracts')
 * @param {string} fileUrl - URL-ul complet al fișierului
 */
export const deleteStorageFile = async (bucket, fileUrl) => {
  if (!fileUrl) return;
  const filePath = extractFilePath(fileUrl);
  if (!filePath) {
    console.warn(`[Storage] Nu s-a putut extrage calea din URL: ${fileUrl}`);
    return;
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(bucket).remove([filePath]);
    if (error) {
      console.warn(`[Storage] Eroare la ștergerea ${filePath} din ${bucket}:`, error.message);
    } else {
      console.log(`[Storage] Șters: ${bucket}/${filePath}`);
    }
  } catch (err) {
    console.warn(`[Storage] Excepție la ștergerea fișierului:`, err.message);
  }
};

/**
 * Șterge mai multe fișiere dintr-un bucket.
 * Ignoră URL-urile null/undefined.
 *
 * @param {string}   bucket   - numele bucket-ului
 * @param {string[]} fileUrls - lista de URL-uri
 */
export const deleteStorageFiles = async (bucket, fileUrls) => {
  const paths = fileUrls
    .filter(Boolean)
    .map(extractFilePath)
    .filter(Boolean);

  if (paths.length === 0) return;

  try {
    const supabase = getSupabase();
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      console.warn(`[Storage] Eroare la ștergerea multiplă din ${bucket}:`, error.message);
    } else {
      console.log(`[Storage] Șterse ${paths.length} fișiere din ${bucket}`);
    }
  } catch (err) {
    console.warn(`[Storage] Excepție la ștergerea multiplă:`, err.message);
  }
};