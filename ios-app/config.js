/*
 * RTEC PHC Field Reporting — offline app configuration.
 *
 * The Services Performed and Ornamental Pests/Conditions choice lists,
 * plus the letterhead text, are sourced from RTEC's real PHCI Visit
 * Report PDF (OneDrive: Plant Health Care Department/SOPs/PHCI Reporting/
 * RTEC PHCI client visit report.pdf) — the playbook itself never
 * enumerated these. Photo handling follows the original build playbook
 * (embedded finding pages), not that PDF's separate photo-log convention.
 */
window.PHC_CONFIG = {
  servicesPerformed: [
    'Treatment per contract',
    'Landscape inspection',
    'Fertilization / soil care',
    'Monitoring',
    'Root care',
    'Pruning',
    'Other',
  ],

  // "Ornamental Pests / Conditions" checkboxes, Page 1 of the real form.
  // Not in the original build playbook's field list — added because the
  // production template already requires it.
  ornamentalPestsConditions: [
    'Anthracnose',
    'Aphids',
    'Blight',
    'Borers',
    'Lace bugs',
    'Leaf miners',
    'Leaf spot',
    'Mites',
    'Powdery mildew',
    'Scale',
    'Whiteflies',
    'Woolly adelgid',
    'Compaction',
    'Drainage issue',
    'Root-zone issue',
    'Other',
  ],

  visitTypes: ['Targeted Treatment', 'Landscape Inspection'],
  priorityChoices: ['Routine', 'Prompt', 'Immediate'],

  reportTitle: 'PLANT HEALTH CARE VISIT REPORT',

  // Header/footer text lifted verbatim from the real PDF. No source file
  // for the actual RTEC logo mark was available, so the header is
  // text-only rather than a recreated/approximated logo.
  company: {
    name: 'RTEC Treecare',
    legalName: 'Ross Tree Expert Company dba RTEC Treecare',
    address: '2828 Mary Street | Falls Church, VA 22042',
    contact: '703.573.3029 | rtectreecare.com',
  },

  theme: {
    navy: '#123A5C',
    fieldShade: '#EAF1F6',
    leaf: '#5B8C5A',
  },
};
