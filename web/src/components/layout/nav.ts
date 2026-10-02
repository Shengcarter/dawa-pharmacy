import {
  BarChart3, Bell, Boxes, ClipboardList, FileClock, LayoutDashboard, Settings, ShoppingCart, Truck, Users,
  UserCog, Wallet, type LucideIcon,
} from 'lucide-react';

export interface NavLeaf {
  label: string;
  to: string;
  permission?: string[];
}
export interface NavItem {
  label: string;
  icon: LucideIcon;
  to?: string;
  permission?: string[];
  children?: NavLeaf[];
}

/** Sidebar structure. Items the user cannot access are hidden (the API enforces the same rules). */
export const NAV: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/', permission: ['dashboard.view'] },
  {
    label: 'Sales',
    icon: ShoppingCart,
    permission: ['pos.sell', 'sales.view', 'sales.view_all'],
    children: [
      { label: 'Point of sale', to: '/pos', permission: ['pos.sell'] },
      { label: 'Invoices', to: '/sales', permission: ['sales.view', 'sales.view_all'] },
      { label: 'Returns', to: '/sales/returns', permission: ['sales.return', 'sales.view_all'] },
    ],
  },
  {
    label: 'Inventory',
    icon: Boxes,
    permission: ['products.view', 'inventory.view'],
    children: [
      { label: 'All products', to: '/inventory/products', permission: ['products.view'] },
      { label: 'Medicines', to: '/inventory/medicines', permission: ['products.view'] },
      { label: 'Categories', to: '/inventory/categories', permission: ['products.view'] },
      { label: 'Stock levels', to: '/inventory/stock', permission: ['inventory.view'] },
      { label: 'Expiry tracking', to: '/inventory/expiry', permission: ['inventory.view'] },
      { label: 'Batch management', to: '/inventory/batches', permission: ['inventory.view'] },
      { label: 'Stock adjustments', to: '/inventory/adjustments', permission: ['inventory.view'] },
      { label: 'Stock movements', to: '/inventory/movements', permission: ['inventory.view'] },
    ],
  },
  {
    label: 'Purchasing',
    icon: Truck,
    permission: ['purchasing.view', 'suppliers.view'],
    children: [
      { label: 'Purchase orders', to: '/purchasing/orders', permission: ['purchasing.view'] },
      { label: 'Suppliers', to: '/purchasing/suppliers', permission: ['suppliers.view'] },
      { label: 'Receive stock', to: '/purchasing/receipts', permission: ['purchasing.view'] },
    ],
  },
  { label: 'Prescriptions', icon: ClipboardList, to: '/prescriptions', permission: ['prescriptions.view'] },
  { label: 'Customers', icon: Users, to: '/customers', permission: ['customers.view'] },
  { label: 'Expenses', icon: Wallet, to: '/expenses', permission: ['expenses.view'] },
  { label: 'Employees & users', icon: UserCog, to: '/users', permission: ['users.view'] },
  {
    label: 'Reports',
    icon: BarChart3,
    permission: ['reports.sales', 'reports.inventory', 'reports.purchases', 'reports.financial', 'reports.staff'],
    children: [
      { label: 'Sales', to: '/reports/sales', permission: ['reports.sales'] },
      { label: 'Purchases', to: '/reports/purchases', permission: ['reports.purchases'] },
      { label: 'Inventory', to: '/reports/inventory', permission: ['reports.inventory'] },
      { label: 'Profit & loss', to: '/reports/profit-loss', permission: ['reports.financial'] },
      { label: 'Expenses', to: '/reports/expenses', permission: ['reports.financial'] },
      { label: 'Expiry', to: '/reports/expiry', permission: ['reports.inventory'] },
      { label: 'Tax', to: '/reports/tax', permission: ['reports.sales'] },
      { label: 'Staff performance', to: '/reports/staff', permission: ['reports.staff'] },
    ],
  },
  { label: 'Notifications', icon: Bell, to: '/notifications' },
  { label: 'Settings', icon: Settings, to: '/settings', permission: ['settings.view', 'settings.manage', 'roles.manage'] },
  { label: 'Audit log', icon: FileClock, to: '/audit-log', permission: ['audit.view'] },
];

