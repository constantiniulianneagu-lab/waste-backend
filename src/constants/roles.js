// src/constants/roles.js
// ============================================================================
// ROLE DEFINITIONS + PERMISSIONS (single source of truth)
// ============================================================================

export const ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',         // ADIGIDMB (id institutie=100)
  ADMIN_INSTITUTION: 'ADMIN_INSTITUTION',   // PMB / Primarii sectoare
  EDITOR_INSTITUTION: 'EDITOR_INSTITUTION', // subordonati PMB/Sectoare
  REGULATOR_VIEWER: 'REGULATOR_VIEWER',     // MMAP / GNM / APM etc.
};

export const ROLE_LABELS = {
  PLATFORM_ADMIN: 'Administrator Platformă',
  ADMIN_INSTITUTION: 'Administrator Instituție',
  EDITOR_INSTITUTION: 'Editor Instituție',
  REGULATOR_VIEWER: 'Regulator (Viewer)',
};

export const ROLE_DESCRIPTIONS = {
  PLATFORM_ADMIN: 'Acces complet (vizualizare + administrare + CRUD).',
  ADMIN_INSTITUTION: 'Vizualizare + export în aria de acces (sector/PMB). Fără CRUD.',
  EDITOR_INSTITUTION: 'Vizualizare + export în aria de acces (sector/PMB). Fără CRUD.',
  REGULATOR_VIEWER: 'Vizualizare + export (fără pagina Reports). Fără CRUD.',
};

// ----------------------------------------------------------------------------
// Role checks
// ----------------------------------------------------------------------------
export const isPlatformAdmin = (role) => role === ROLES.PLATFORM_ADMIN;
export const isInstitutionAdmin = (role) => role === ROLES.ADMIN_INSTITUTION;
export const isInstitutionEditor = (role) => role === ROLES.EDITOR_INSTITUTION;
export const isRegulator = (role) => role === ROLES.REGULATOR_VIEWER;

export const isInstitutionRole = (role) =>
  role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION;

// ----------------------------------------------------------------------------
// Permissions (current policy)
// ----------------------------------------------------------------------------
// IMPORTANT: "Momentan nu vom da posibilitatea de Adaugari/Ștergere/Editare nimanui
// cu exceptia PLATFORM_ADMIN."
export const canCreateData = (role) => role === ROLES.PLATFORM_ADMIN;
export const canEditData = (role) => role === ROLES.PLATFORM_ADMIN;
export const canDeleteData = (role) => role === ROLES.PLATFORM_ADMIN;

// everyone can export (within their visibility scope)
export const canExportData = () => true;

// Pages
export const canAccessDashboards = () => true;

// FIX #6: REGULATOR_VIEWER NU are Reports
export const canAccessReports = (role) => role !== ROLES.REGULATOR_VIEWER;

// Only PLATFORM_ADMIN can access Users page
export const canAccessUsersPage = (role) => role === ROLES.PLATFORM_ADMIN;

// Only PLATFORM_ADMIN can access Institutions page
export const canAccessInstitutionsPage = (role) => role === ROLES.PLATFORM_ADMIN;

// All roles except REGULATOR_VIEWER can access Sectors page
export const canAccessSectorsPage = (role) => 
  role === ROLES.PLATFORM_ADMIN || 
  role === ROLES.ADMIN_INSTITUTION || 
  role === ROLES.EDITOR_INSTITUTION;

export const canViewOperatorsInProfile = (role) => role !== ROLES.REGULATOR_VIEWER;

// ----------------------------------------------------------------------------
// Page Scope Resolution
// ----------------------------------------------------------------------------
/**
 * Returns the access scope for a specific page based on user role
 * @param {string} page - Page identifier (landfill, tmb, reports, sectors, profileContracts, users, institutions)
 * @param {string} role - User role
 * @param {boolean} isPMB - Whether user's institution is PMB (has all 6 sectors)
 * @returns {'ALL'|'SECTOR'|'NONE'} Access scope
 */
export const getPageScope = (page, role, isPMB = false) => {
  // PLATFORM_ADMIN: Full access to everything
  if (role === ROLES.PLATFORM_ADMIN) {
    return 'ALL';
  }

  // REGULATOR_VIEWER: Special case - read-only access
  if (role === ROLES.REGULATOR_VIEWER) {
    switch (page) {
      case 'landfill':
      case 'tmb':
      case 'sectors':
        return 'ALL'; // Read-only access to all sectors
      case 'reports':
      case 'profileContracts':
      case 'users':
      case 'institutions':
        return 'NONE'; // No access
      default:
        return 'NONE';
    }
  }

  // ADMIN_INSTITUTION: PMB user with read-only access
  if (role === ROLES.ADMIN_INSTITUTION) {
    switch (page) {
      case 'landfill':
      case 'tmb':
        return 'ALL'; // All sectors read-only
      case 'reports':
      case 'sectors':
      case 'profileContracts':
        return 'ALL'; // All sectors read-only
      case 'users':
      case 'institutions':
        return 'NONE'; // No access
      default:
        return 'NONE';
    }
  }

  // EDITOR_INSTITUTION: Sector city hall user
  if (role === ROLES.EDITOR_INSTITUTION) {
    switch (page) {
      case 'landfill':
      case 'tmb':
        return 'ALL'; // All sectors read-only
      case 'reports':
      case 'sectors':
      case 'profileContracts':
        return 'SECTOR'; // Only their sector, read-only
      case 'users':
      case 'institutions':
        return 'NONE'; // No access
      default:
        return 'NONE';
    }
  }

  return 'NONE';
};


// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------
export const isValidRole = (role) => Object.values(ROLES).includes(role);

export const getRoleLabel = (role) => ROLE_LABELS[role] || role;
export const getRoleDescription = (role) => ROLE_DESCRIPTIONS[role] || '';

export const getAllRoles = () => Object.values(ROLES);

export const getRolesForDropdown = () =>
  Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export default {
  ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  isPlatformAdmin,
  isInstitutionAdmin,
  isInstitutionEditor,
  isRegulator,
  isInstitutionRole,
  canCreateData,
  canEditData,
  canDeleteData,
  canExportData,
  canAccessDashboards,
  canAccessReports,
  canAccessUsersPage,
  canAccessInstitutionsPage,
  canAccessSectorsPage,
  canViewOperatorsInProfile,
  getPageScope,
  isValidRole,
  getRoleLabel,
  getRoleDescription,
  getAllRoles,
  getRolesForDropdown,
};