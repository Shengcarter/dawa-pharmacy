/**
 * Permission catalogue. The API enforces these on every route; the web app
 * uses the same list only to hide actions the API would refuse.
 */
export const PERMISSION_GROUPS = {
  dashboard: { label: 'Dashboard', permissions: { 'dashboard.view': 'View dashboard' } },
  pos: {
    label: 'Point of sale',
    permissions: {
      'pos.sell': 'Process sales',
      'pos.discount': 'Apply discounts within the configured limit',
      'pos.discount_override': 'Exceed discount limit or sell below minimum price',
      'pos.credit_sale': 'Sell on credit',
    },
  },
  sales: {
    label: 'Sales',
    permissions: {
      'sales.view': 'View own sales',
      'sales.view_all': 'View all staff sales',
      'sales.return': 'Process returns and refunds',
      'sales.record_payment': 'Record customer payments',
    },
  },
  products: {
    label: 'Products',
    permissions: {
      'products.view': 'View products',
      'products.manage': 'Create and edit products, categories and manufacturers',
      'products.manage_prices': 'Change product prices',
    },
  },
  inventory: {
    label: 'Inventory',
    permissions: {
      'inventory.view': 'View stock, batches, expiry and movements',
      'inventory.adjust': 'Adjust stock and dispose of batches',
    },
  },
  purchasing: {
    label: 'Purchasing',
    permissions: {
      'purchasing.view': 'View purchase orders and receipts',
      'purchasing.manage': 'Create and edit purchase orders',
      'purchasing.approve': 'Approve and place purchase orders',
      'purchasing.receive': 'Receive stock',
    },
  },
  suppliers: {
    label: 'Suppliers',
    permissions: {
      'suppliers.view': 'View suppliers',
      'suppliers.manage': 'Create and edit suppliers',
      'suppliers.payments': 'Record supplier payments',
    },
  },
  customers: {
    label: 'Customers',
    permissions: {
      'customers.view': 'View customers',
      'customers.manage': 'Create and edit customers',
    },
  },
  prescriptions: {
    label: 'Prescriptions',
    permissions: {
      'prescriptions.view': 'View prescriptions',
      'prescriptions.manage': 'Record and edit prescriptions',
      'prescriptions.dispense': 'Dispense prescription-only medicines',
    },
  },
  expenses: {
    label: 'Expenses',
    permissions: {
      'expenses.view': 'View expenses',
      'expenses.manage': 'Record and edit expenses',
    },
  },
  reports: {
    label: 'Reports',
    permissions: {
      'reports.sales': 'Sales and tax reports',
      'reports.inventory': 'Inventory and expiry reports',
      'reports.purchases': 'Purchase reports',
      'reports.financial': 'Profit & loss, expense reports and profit figures',
      'reports.staff': 'Staff performance',
    },
  },
  users: {
    label: 'Users',
    permissions: {
      'users.view': 'View users',
      'users.manage': 'Create users, reset passwords, change status',
      'roles.manage': 'Edit roles and permissions',
    },
  },
  system: {
    label: 'System',
    permissions: {
      'settings.view': 'View settings',
      'settings.manage': 'Change settings',
      'audit.view': 'View audit log',
      'backups.manage': 'Create and download backups',
    },
  },
} as const;

type Groups = typeof PERMISSION_GROUPS;
export type Permission = {
  [G in keyof Groups]: keyof Groups[G]['permissions'];
}[keyof Groups] & string;

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) =>
  Object.keys(g.permissions),
) as Permission[];

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(PERMISSION_GROUPS).flatMap((g) => Object.entries(g.permissions)),
);

export const SYSTEM_ROLES = {
  super_admin: {
    name: 'Super Admin',
    description: 'Full access to every module and setting.',
    permissions: ALL_PERMISSIONS,
  },
  manager: {
    name: 'Owner / Manager',
    description: 'Runs the business: inventory, purchasing, sales, finance, staff and settings.',
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'roles.manage'),
  },
  pharmacist: {
    name: 'Pharmacist',
    description: 'Dispenses prescriptions, sells, and manages stock on the shelf.',
    permissions: [
      'dashboard.view', 'pos.sell', 'pos.discount', 'sales.view', 'sales.return',
      'products.view', 'inventory.view', 'inventory.adjust', 'purchasing.view', 'purchasing.receive',
      'customers.view', 'customers.manage',
      'prescriptions.view', 'prescriptions.manage', 'prescriptions.dispense',
      'reports.inventory',
    ] as Permission[],
  },
  cashier: {
    name: 'Cashier',
    description: 'Point of sale and own sales history.',
    permissions: [
      'dashboard.view', 'pos.sell', 'sales.view', 'products.view', 'customers.view', 'customers.manage',
    ] as Permission[],
  },
  inventory_officer: {
    name: 'Inventory Officer',
    description: 'Stock control, batches, expiry, purchasing and receiving.',
    permissions: [
      'dashboard.view', 'products.view', 'products.manage', 'inventory.view', 'inventory.adjust',
      'purchasing.view', 'purchasing.manage', 'purchasing.receive', 'suppliers.view', 'suppliers.manage',
      'reports.inventory', 'reports.purchases',
    ] as Permission[],
  },
  accountant: {
    name: 'Accountant',
    description: 'Financial records, payments, expenses and reports.',
    permissions: [
      'dashboard.view', 'sales.view', 'sales.view_all', 'sales.record_payment', 'products.view',
      'inventory.view', 'purchasing.view', 'suppliers.view', 'suppliers.payments', 'customers.view',
      'expenses.view', 'expenses.manage',
      'reports.sales', 'reports.inventory', 'reports.purchases', 'reports.financial', 'reports.staff',
    ] as Permission[],
  },
} as const satisfies Record<string, { name: string; description: string; permissions: readonly Permission[] }>;

export type SystemRoleCode = keyof typeof SYSTEM_ROLES;
