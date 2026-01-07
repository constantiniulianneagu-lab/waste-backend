// src/constants/roles.js
// ============================================================================
// ROLE DEFINITIONS + PERMISSIONS (single source of truth)
// Versiune: 2.0 - Simplificată conform cerințelor 06.01.2025
// ============================================================================

export const ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',           // ADIGIDMB (institution_id=100)
  ADMIN_INSTITUTION: 'ADMIN_INSTITUTION',     // PMB - Primăria Municipiului București
  EDITOR_INSTITUTION: 'EDITOR_INSTITUTION',   // Primării Sectoare 1-6
  REGULATOR_VIEWER: 'REGULATOR_VIEWER',       // MMAP / GNM / APM / Alte autorități
};

export const ROLE_LABELS = {
  PLATFORM_ADMIN: 'Administrator Platformă',
  ADMIN_INSTITUTION: 'Administrator Instituție',
  EDITOR_INSTITUTION: 'Editor Instituție',
  REGULATOR_VIEWER: 'Regulator (Viewer)',
};

export const ROLE_DESCRIPTIONS = {
  PLATFORM_ADMIN: 'Acces complet la toate datele și funcționalitățile platformei (CRUD).',
  ADMIN_INSTITUTION: 'Acces complet la date (read-only), fără posibilitate de modificare.',
  EDITOR_INSTITUTION: 'Acces limitat la sectorul instituției (read-only).',
  REGULATOR_VIEWER: 'Acces de vizualizare pentru autoritățile de reglementare.',
};

// ============================================================================
// MATRICE DE PERMISIUNI - VERSIUNEA FINALĂ
// ============================================================================
// Bazată pe tabelul de cerințe consolidat:
//
// ┌──────────────────┬────────────────┬────────────────┬────────────────┬──────────────────┐
// │ Pagină           │ PLATFORM_ADMIN │ INSTITUTION_   │ EDITOR_        │ REGULATOR_VIEWER │
// │                  │                │ ADMIN (PMB)    │ INSTITUTION    │                  │
// ├──────────────────┼────────────────┼────────────────┼────────────────┼──────────────────┤
// │ Depozitare       │ Toate, CRUD    │ Toate, R/O     │ Toate, R/O     │ Toate, R/O       │
// │ TMB              │ Toate, CRUD    │ Toate, R/O     │ Toate, R/O     │ Toate, R/O       │
// │ Rapoarte         │ Toate, CRUD    │ Toate, R/O     │ Sector X, R/O  │ ❌ Nu vede       │
// │ Profil-Contracte │ Toate          │ Toate          │ Sector X       │ ❌ Nu vede       │
// │ Sectoare         │ Toate, CRUD    │ Toate, R/O     │ Sector X, R/O  │ Toate, R/O       │
// │ Utilizatori      │ Toți, CRUD     │ ❌ Nu vede     │ ❌ Nu vede     │ ❌ Nu vede       │
// │ Instituții       │ Toate, CRUD    │ ❌ Nu vede     │ ❌ Nu vede     │ ❌ Nu vede       │
// └──────────────────┴────────────────┴────────────────┴────────────────┴──────────────────┘

// ----------------------------------------------------------------------------
// CRUD PERMISSIONS - Doar PLATFORM_ADMIN poate modifica date
// ----------------------------------------------------------------------------
export const canCreateData = (role) => role === ROLES.PLATFORM_ADMIN;
export const canEditData = (role) => role === ROLES.PLATFORM_ADMIN;
export const canDeleteData = (role) => role === ROLES.PLATFORM_ADMIN;

// Toți pot exporta date (în limitele vizibilității lor)
export const canExportData = () => true;

// ----------------------------------------------------------------------------
// PAGE ACCESS PERMISSIONS
// ----------------------------------------------------------------------------

// Depozitare (Landfill) - Toți văd, doar PLATFORM_ADMIN poate edita
export const canAccessLandfillPage = () => true;

// TMB (Tratare Mecano-Biologică) - Toți văd, doar PLATFORM_ADMIN poate edita
export const canAccessTMBPage = () => true;

// Rapoarte - Toți EXCEPT REGULATOR_VIEWER
export const canAccessReportsPage = (role) => role !== ROLES.REGULATOR_VIEWER;

// Sectoare - Toți văd (inclusiv REGULATOR_VIEWER)
export const canAccessSectorsPage = () => true;

// Utilizatori - Doar PLATFORM_ADMIN
export const canAccessUsersPage = (role) => role === ROLES.PLATFORM_ADMIN;

// Instituții - Doar PLATFORM_ADMIN
export const canAccessInstitutionsPage = (role) => role === ROLES.PLATFORM_ADMIN;

// Profil - Secțiunea Contracte - Toți EXCEPT REGULATOR_VIEWER
export const canViewContractsInProfile = (role) => role !== ROLES.REGULATOR_VIEWER;

// ----------------------------------------------------------------------------
// DATA VISIBILITY SCOPE (pentru fiecare pagină)
// ----------------------------------------------------------------------------

/**
 * Determină scope-ul de vizibilitate pentru o pagină specifică
 * @param {string} role - Rolul utilizatorului
 * @param {string} page - Numele paginii
 * @returns {string} - 'ALL' | 'SECTOR' | 'NONE'
 */
export const getPageScope = (role, page) => {
  const scopeMatrix = {
    // Depozitare & TMB - toți văd toate sectoarele
    landfill: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'ALL',
      EDITOR_INSTITUTION: 'ALL',
      REGULATOR_VIEWER: 'ALL',
    },
    tmb: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'ALL',
      EDITOR_INSTITUTION: 'ALL',
      REGULATOR_VIEWER: 'ALL',
    },
    // Rapoarte - EDITOR vede doar sectorul său
    reports: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'ALL',
      EDITOR_INSTITUTION: 'SECTOR',
      REGULATOR_VIEWER: 'NONE',
    },
    // Sectoare - EDITOR vede doar sectorul său, REGULATOR vede toate
    sectors: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'ALL',
      EDITOR_INSTITUTION: 'SECTOR',
      REGULATOR_VIEWER: 'ALL',
    },
    // Contracte (în profil) - EDITOR vede doar sectorul său
    profileContracts: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'ALL',
      EDITOR_INSTITUTION: 'SECTOR',
      REGULATOR_VIEWER: 'NONE',
    },
    // Utilizatori - doar PLATFORM_ADMIN
    users: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'NONE',
      EDITOR_INSTITUTION: 'NONE',
      REGULATOR_VIEWER: 'NONE',
    },
    // Instituții - doar PLATFORM_ADMIN
    institutions: {
      PLATFORM_ADMIN: 'ALL',
      ADMIN_INSTITUTION: 'NONE',
      EDITOR_INSTITUTION: 'NONE',
      REGULATOR_VIEWER: 'NONE',
    },
  };

  return scopeMatrix[page]?.[role] || 'NONE';
};

// ----------------------------------------------------------------------------
// ROLE CHECKS (helper functions)
// ----------------------------------------------------------------------------
export const isPlatformAdmin = (role) => role === ROLES.PLATFORM_ADMIN;
export const isInstitutionAdmin = (role) => role === ROLES.ADMIN_INSTITUTION;
export const isInstitutionEditor = (role) => role === ROLES.EDITOR_INSTITUTION;
export const isRegulator = (role) => role === ROLES.REGULATOR_VIEWER;

export const isInstitutionRole = (role) =>
  role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION;

export const hasFullAccess = (role) => role === ROLES.PLATFORM_ADMIN;

// ----------------------------------------------------------------------------
// VALIDATION
// ----------------------------------------------------------------------------
export const isValidRole = (role) => Object.values(ROLES).includes(role);

export const getRoleLabel = (role) => ROLE_LABELS[role] || role;
export const getRoleDescription = (role) => ROLE_DESCRIPTIONS[role] || '';

export const getAllRoles = () => Object.values(ROLES);

export const getRolesForDropdown = () =>
  Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

// ----------------------------------------------------------------------------
// INSTITUTION TYPE CONSTANTS
// ----------------------------------------------------------------------------
export const INSTITUTION_TYPES = {
  ASSOCIATION: 'ASSOCIATION',       // ADIGIDMB
  MUNICIPALITY: 'MUNICIPALITY',     // PMB
  CITY_HALL: 'CITY_HALL',          // Primării Sectoare
  OPERATOR: 'OPERATOR',             // Operatori salubritate
  REGULATOR: 'REGULATOR',           // Autorități reglementare
  OTHER: 'OTHER',
};

// ID-ul instituției ADIGIDMB (hardcodat conform cerințelor)
export const ADIGIDMB_INSTITUTION_ID = 100;

// ----------------------------------------------------------------------------
// HELPER: Verifică dacă instituția este PMB
// ----------------------------------------------------------------------------
export const isPMBInstitution = (institutionSectorIds) => {
  // PMB are toate cele 6 sectoare mapate
  return institutionSectorIds && institutionSectorIds.length === 6;
};

// ----------------------------------------------------------------------------
// EXPORT DEFAULT
// ----------------------------------------------------------------------------
export default {
  ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  INSTITUTION_TYPES,
  ADIGIDMB_INSTITUTION_ID,
  
  // Permissions
  canCreateData,
  canEditData,
  canDeleteData,
  canExportData,
  
  // Page access
  canAccessLandfillPage,
  canAccessTMBPage,
  canAccessReportsPage,
  canAccessSectorsPage,
  canAccessUsersPage,
  canAccessInstitutionsPage,
  canViewContractsInProfile,
  
  // Scope
  getPageScope,
  
  // Role checks
  isPlatformAdmin,
  isInstitutionAdmin,
  isInstitutionEditor,
  isRegulator,
  isInstitutionRole,
  hasFullAccess,
  
  // Validation
  isValidRole,
  getRoleLabel,
  getRoleDescription,
  getAllRoles,
  getRolesForDropdown,
  
  // Helpers
  isPMBInstitution,
};