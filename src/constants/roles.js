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

export const canAccessUsersPage = (role) =>
  role === ROLES.PLATFORM_ADMIN || role === ROLES.ADMIN_INSTITUTION;

export const canAccessInstitutionsPage = (role) =>
  role === ROLES.PLATFORM_ADMIN || role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION;

export const canAccessSectorsPage = (role) =>
  role === ROLES.PLATFORM_ADMIN || role === ROLES.ADMIN_INSTITUTION || role === ROLES.EDITOR_INSTITUTION;

export const canViewOperatorsInProfile = (role) => role !== ROLES.REGULATOR_VIEWER;

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
  isValidRole,
  getRoleLabel,
  getRoleDescription,
  getAllRoles,
  getRolesForDropdown,
};
