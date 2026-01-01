// src/constants/roles.js
// ============================================================================
// DEFINIREA ROLURILOR ȘI HELPER FUNCTIONS
// ============================================================================

/**
 * Roluri disponibile în sistem
 * Bazat pe documentația finală confirmată (31 Dec 2024)
 */
export const ROLES = {
    PLATFORM_ADMIN: 'PLATFORM_ADMIN',           // ADIGIDMB - acces total, CRUD complet
    ADMIN_INSTITUTION: 'ADMIN_INSTITUTION',      // PMB sau Sector - DOAR vizualizare + export
    EDITOR_INSTITUTION: 'EDITOR_INSTITUTION',    // Subordonați PMB/Sector - DOAR vizualizare + export
    REGULATOR_VIEWER: 'REGULATOR_VIEWER',        // Autoritate Publică - DOAR vizualizare + export
  };
  
  /**
   * Labels în română pentru UI
   */
  export const ROLE_LABELS = {
    PLATFORM_ADMIN: 'Administrator Platformă',
    ADMIN_INSTITUTION: 'Administrator Instituție',
    EDITOR_INSTITUTION: 'Editor Instituție',
    REGULATOR_VIEWER: 'Autoritate Publică',
  };
  
  /**
   * Descrieri roluri pentru tooltip/help
   */
  export const ROLE_DESCRIPTIONS = {
    PLATFORM_ADMIN: 'Acces complet la toate datele și funcționalitățile sistemului (ADIGIDMB)',
    ADMIN_INSTITUTION: 'Administrator instituție (PMB sau Sector) - vizualizare și export date',
    EDITOR_INSTITUTION: 'Editor instituție - vizualizare și export date din sectoarele instituției',
    REGULATOR_VIEWER: 'Autoritate publică - vizualizare și export date conform permisiunilor',
  };
  
  // ============================================================================
  // HELPER FUNCTIONS - Verificări rol
  // ============================================================================
  
  /**
   * Verifică dacă user-ul este PLATFORM_ADMIN (ADIGIDMB)
   */
  export const isPlatformAdmin = (role) => {
    return role === ROLES.PLATFORM_ADMIN;
  };
  
  /**
   * Verifică dacă user-ul este Administrator Instituție
   */
  export const isInstitutionAdmin = (role) => {
    return role === ROLES.ADMIN_INSTITUTION;
  };
  
  /**
   * Verifică dacă user-ul este Editor Instituție
   */
  export const isEditor = (role) => {
    return role === ROLES.EDITOR_INSTITUTION;
  };
  
  /**
   * Verifică dacă user-ul este Autoritate Publică (Regulator)
   */
  export const isRegulator = (role) => {
    return role === ROLES.REGULATOR_VIEWER;
  };
  
  /**
   * Verifică dacă user-ul aparține unei instituții (PMB sau Sector)
   */
  export const isInstitutionRole = (role) => {
    return role === ROLES.ADMIN_INSTITUTION || 
           role === ROLES.EDITOR_INSTITUTION;
  };
  
  // ============================================================================
  // HELPER FUNCTIONS - Verificări permisiuni
  // ============================================================================
  
  /**
   * Verifică dacă user-ul poate CREA date (tickete, contracte, etc.)
   * MOMENTAN: DOAR PLATFORM_ADMIN
   * VIITOR: + OPERATOR_USER + Sectoare (după teste)
   */
  export const canCreateData = (role) => {
    return role === ROLES.PLATFORM_ADMIN;
  };
  
  /**
   * Verifică dacă user-ul poate EDITA date
   * MOMENTAN: DOAR PLATFORM_ADMIN
   * VIITOR: + OPERATOR_USER + Sectoare (după teste)
   */
  export const canEditData = (role) => {
    return role === ROLES.PLATFORM_ADMIN;
  };
  
  /**
   * Verifică dacă user-ul poate ȘTERGE date
   * MOMENTAN: DOAR PLATFORM_ADMIN
   * VIITOR: poate rămâne doar PLATFORM_ADMIN
   */
  export const canDeleteData = (role) => {
    return role === ROLES.PLATFORM_ADMIN;
  };
  
  /**
   * Verifică dacă user-ul are DOAR permisiuni de vizualizare
   */
  export const canViewOnly = (role) => {
    return role === ROLES.ADMIN_INSTITUTION ||
           role === ROLES.EDITOR_INSTITUTION ||
           role === ROLES.REGULATOR_VIEWER;
  };
  
  /**
   * Verifică dacă user-ul poate EXPORTA date
   * TOȚI pot exporta, dar doar ce au acces să vadă
   */
  export const canExportData = (role) => {
    return true;  // Toți rolurile pot exporta
  };
  
  /**
   * Verifică dacă user-ul poate gestiona alți utilizatori
   * PLATFORM_ADMIN: toți userii
   * INSTITUTION_ADMIN: userii din instituția lui
   */
  export const canManageUsers = (role) => {
    return role === ROLES.PLATFORM_ADMIN ||
           role === ROLES.ADMIN_INSTITUTION;
  };
  
  /**
   * Verifică dacă user-ul poate vedea pagina Utilizatori
   */
  export const canAccessUsersPage = (role) => {
    return canManageUsers(role);
  };
  
  /**
   * Verifică dacă user-ul poate vedea pagina Instituții
   */
  export const canAccessInstitutionsPage = (role) => {
    return role === ROLES.PLATFORM_ADMIN ||
           role === ROLES.ADMIN_INSTITUTION ||
           role === ROLES.EDITOR_INSTITUTION;
  };
  
  /**
   * Verifică dacă user-ul poate vedea pagina Sectoare
   */
  export const canAccessSectorsPage = (role) => {
    return role === ROLES.PLATFORM_ADMIN ||
           role === ROLES.ADMIN_INSTITUTION ||
           role === ROLES.EDITOR_INSTITUTION;
  };
  
  /**
   * Verifică dacă user-ul poate vedea secțiunea Operatori în Profil
   */
  export const canViewOperatorsInProfile = (role) => {
    return role !== ROLES.REGULATOR_VIEWER;  // Toți în afară de REGULATOR
  };
  
  /**
   * Verifică dacă user-ul poate vedea Dashboard-uri (Depozitare, TMB)
   */
  export const canAccessDashboards = (role) => {
    return true;  // Toți au acces la dashboard-uri
  };
  
  /**
   * Verifică dacă user-ul poate vedea Rapoarte
   */
  export const canAccessReports = (role) => {
    return true;  // Toți au acces la rapoarte (inclusiv REGULATOR_VIEWER)
  };
  
  // ============================================================================
  // UTILITY FUNCTIONS
  // ============================================================================
  
  /**
   * Returnează label-ul în română pentru un rol
   */
  export const getRoleLabel = (role) => {
    return ROLE_LABELS[role] || role;
  };
  
  /**
   * Returnează descrierea pentru un rol
   */
  export const getRoleDescription = (role) => {
    return ROLE_DESCRIPTIONS[role] || '';
  };
  
  /**
   * Validează dacă un string reprezintă un rol valid
   */
  export const isValidRole = (role) => {
    return Object.values(ROLES).includes(role);
  };
  
  /**
   * Returnează array cu toate rolurile disponibile
   */
  export const getAllRoles = () => {
    return Object.values(ROLES);
  };
  
  /**
   * Returnează array cu roluri pentru dropdown (cu labels)
   */
  export const getRolesForDropdown = () => {
    return Object.entries(ROLE_LABELS).map(([value, label]) => ({
      value,
      label
    }));
  };
  
  // ============================================================================
  // EXPORTS
  // ============================================================================
  
  export default {
    ROLES,
    ROLE_LABELS,
    ROLE_DESCRIPTIONS,
    isPlatformAdmin,
    isInstitutionAdmin,
    isEditor,
    isRegulator,
    isInstitutionRole,
    canCreateData,
    canEditData,
    canDeleteData,
    canViewOnly,
    canExportData,
    canManageUsers,
    canAccessUsersPage,
    canAccessInstitutionsPage,
    canAccessSectorsPage,
    canViewOperatorsInProfile,
    canAccessDashboards,
    canAccessReports,
    getRoleLabel,
    getRoleDescription,
    isValidRole,
    getAllRoles,
    getRolesForDropdown,
  };