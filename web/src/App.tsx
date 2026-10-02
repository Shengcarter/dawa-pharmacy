import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { PageLoader } from './components/ui';
import { useAuth } from './lib/auth';
import { SettingsProvider } from './lib/settings';
import { NoAccess, NotFound } from './features/common/StatusPages';

const p = <T extends Record<string, unknown>>(loader: () => Promise<T>, name: keyof T) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })));

const LoginPage = p(() => import('./features/auth/LoginPage'), 'LoginPage');
const ForgotPasswordPage = p(() => import('./features/auth/PasswordPages'), 'ForgotPasswordPage');
const ResetPasswordPage = p(() => import('./features/auth/PasswordPages'), 'ResetPasswordPage');
const PublicReceiptPage = p(() => import('./features/sales/PublicReceiptPage'), 'PublicReceiptPage');
const DashboardPage = p(() => import('./features/dashboard/DashboardPage'), 'DashboardPage');
const PosPage = p(() => import('./features/pos/PosPage'), 'PosPage');
const SalesPage = p(() => import('./features/sales/SalesPage'), 'SalesPage');
const SaleDetailPage = p(() => import('./features/sales/SaleDetailPage'), 'SaleDetailPage');
const ReturnsPage = p(() => import('./features/sales/ReturnsPage'), 'ReturnsPage');
const ProductsPage = p(() => import('./features/inventory/ProductsPage'), 'ProductsPage');
const MedicinesPage = p(() => import('./features/inventory/ProductsPage'), 'MedicinesPage');
const ProductFormPage = p(() => import('./features/inventory/ProductFormPage'), 'ProductFormPage');
const ProductDetailPage = p(() => import('./features/inventory/ProductDetailPage'), 'ProductDetailPage');
const CategoriesPage = p(() => import('./features/inventory/CategoriesPage'), 'CategoriesPage');
const StockLevelsPage = p(() => import('./features/inventory/StockPages'), 'StockLevelsPage');
const ExpiryPage = p(() => import('./features/inventory/StockPages'), 'ExpiryPage');
const BatchesPage = p(() => import('./features/inventory/StockPages'), 'BatchesPage');
const AdjustmentsPage = p(() => import('./features/inventory/AdjustmentsPage'), 'AdjustmentsPage');
const MovementsPage = p(() => import('./features/inventory/MovementsPage'), 'MovementsPage');
const LabelsPage = p(() => import('./features/inventory/LabelsPage'), 'LabelsPage');
const PurchaseOrdersPage = p(() => import('./features/purchasing/PurchaseOrdersPage'), 'PurchaseOrdersPage');
const PurchaseOrderFormPage = p(() => import('./features/purchasing/PurchaseOrderFormPage'), 'PurchaseOrderFormPage');
const PurchaseOrderDetailPage = p(() => import('./features/purchasing/PurchaseOrderDetailPage'), 'PurchaseOrderDetailPage');
const SuppliersPage = p(() => import('./features/purchasing/SuppliersPage'), 'SuppliersPage');
const SupplierDetailPage = p(() => import('./features/purchasing/SupplierDetailPage'), 'SupplierDetailPage');
const ReceiptsPage = p(() => import('./features/purchasing/ReceiptsPage'), 'ReceiptsPage');
const ReceiveStockPage = p(() => import('./features/purchasing/ReceiveStockPage'), 'ReceiveStockPage');
const GoodsReceiptDetailPage = p(() => import('./features/purchasing/ReceiptsPage'), 'GoodsReceiptDetailPage');
const PrescriptionsPage = p(() => import('./features/prescriptions/PrescriptionsPage'), 'PrescriptionsPage');
const PrescriptionFormPage = p(() => import('./features/prescriptions/PrescriptionFormPage'), 'PrescriptionFormPage');
const PrescriptionDetailPage = p(() => import('./features/prescriptions/PrescriptionDetailPage'), 'PrescriptionDetailPage');
const CustomersPage = p(() => import('./features/customers/CustomersPage'), 'CustomersPage');
const CustomerDetailPage = p(() => import('./features/customers/CustomerDetailPage'), 'CustomerDetailPage');
const ExpensesPage = p(() => import('./features/expenses/ExpensesPage'), 'ExpensesPage');
const UsersPage = p(() => import('./features/users/UsersPage'), 'UsersPage');
const UserDetailPage = p(() => import('./features/users/UserDetailPage'), 'UserDetailPage');
const ReportsPage = p(() => import('./features/reports/ReportsPage'), 'ReportsPage');
const NotificationsPage = p(() => import('./features/notifications/NotificationsPage'), 'NotificationsPage');
const SettingsPage = p(() => import('./features/settings/SettingsPage'), 'SettingsPage');
const AuditLogPage = p(() => import('./features/audit/AuditLogPage'), 'AuditLogPage');
const ProfilePage = p(() => import('./features/profile/ProfilePage'), 'ProfilePage');

function Guard({ permission, children }: { permission: string[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...permission) ? <>{children}</> : <NoAccess />;
}
const g = (permission: string[], el: ReactNode) => <Guard permission={permission}>{el}</Guard>;

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <DashboardPage />;
  return <Navigate to={can('pos.sell') ? '/pos' : '/profile'} replace />;
}

export function App() {
  const { status } = useAuth();
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><PageLoader /></div>}>
      <SettingsGate signedIn={status === 'signed-in'}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/r/:token" element={<PublicReceiptPage />} />
          <Route element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="pos" element={g(['pos.sell'], <PosPage />)} />
            <Route path="sales" element={g(['sales.view', 'sales.view_all'], <SalesPage />)} />
            <Route path="sales/returns" element={g(['sales.return', 'sales.view', 'sales.view_all'], <ReturnsPage />)} />
            <Route path="sales/:id" element={g(['sales.view', 'sales.view_all'], <SaleDetailPage />)} />
            <Route path="inventory/products" element={g(['products.view'], <ProductsPage />)} />
            <Route path="inventory/medicines" element={g(['products.view'], <MedicinesPage />)} />
            <Route path="inventory/products/new" element={g(['products.manage'], <ProductFormPage />)} />
            <Route path="inventory/products/:id" element={g(['products.view'], <ProductDetailPage />)} />
            <Route path="inventory/products/:id/edit" element={g(['products.manage'], <ProductFormPage />)} />
            <Route path="inventory/categories" element={g(['products.view'], <CategoriesPage />)} />
            <Route path="inventory/stock" element={g(['inventory.view'], <StockLevelsPage />)} />
            <Route path="inventory/expiry" element={g(['inventory.view'], <ExpiryPage />)} />
            <Route path="inventory/batches" element={g(['inventory.view'], <BatchesPage />)} />
            <Route path="inventory/adjustments" element={g(['inventory.view'], <AdjustmentsPage />)} />
            <Route path="inventory/movements" element={g(['inventory.view'], <MovementsPage />)} />
            <Route path="inventory/labels" element={g(['products.view'], <LabelsPage />)} />
            <Route path="purchasing/orders" element={g(['purchasing.view'], <PurchaseOrdersPage />)} />
            <Route path="purchasing/orders/new" element={g(['purchasing.manage'], <PurchaseOrderFormPage />)} />
            <Route path="purchasing/orders/:id" element={g(['purchasing.view'], <PurchaseOrderDetailPage />)} />
            <Route path="purchasing/orders/:id/edit" element={g(['purchasing.manage'], <PurchaseOrderFormPage />)} />
            <Route path="purchasing/suppliers" element={g(['suppliers.view'], <SuppliersPage />)} />
            <Route path="purchasing/suppliers/:id" element={g(['suppliers.view'], <SupplierDetailPage />)} />
            <Route path="purchasing/receipts" element={g(['purchasing.view'], <ReceiptsPage />)} />
            <Route path="purchasing/receipts/new" element={g(['purchasing.receive'], <ReceiveStockPage />)} />
            <Route path="purchasing/receipts/:id" element={g(['purchasing.view', 'suppliers.payments'], <GoodsReceiptDetailPage />)} />
            <Route path="prescriptions" element={g(['prescriptions.view'], <PrescriptionsPage />)} />
            <Route path="prescriptions/new" element={g(['prescriptions.manage'], <PrescriptionFormPage />)} />
            <Route path="prescriptions/:id" element={g(['prescriptions.view'], <PrescriptionDetailPage />)} />
            <Route path="prescriptions/:id/edit" element={g(['prescriptions.manage'], <PrescriptionFormPage />)} />
            <Route path="customers" element={g(['customers.view'], <CustomersPage />)} />
            <Route path="customers/:id" element={g(['customers.view'], <CustomerDetailPage />)} />
            <Route path="expenses" element={g(['expenses.view'], <ExpensesPage />)} />
            <Route path="users" element={g(['users.view'], <UsersPage />)} />
            <Route path="users/:id" element={g(['users.view'], <UserDetailPage />)} />
            <Route path="reports/:report" element={<ReportsPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="settings" element={g(['settings.view', 'settings.manage', 'roles.manage'], <SettingsPage />)} />
            <Route path="audit-log" element={g(['audit.view'], <AuditLogPage />)} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </SettingsGate>
    </Suspense>
  );
}

/** Settings (currency, time zone) are only fetched once signed in. */
function SettingsGate({ signedIn, children }: { signedIn: boolean; children: ReactNode }) {
  return signedIn ? <SettingsProvider>{children}</SettingsProvider> : <PublicSettings>{children}</PublicSettings>;
}
function PublicSettings({ children }: { children: ReactNode }) {
  return <SettingsProvider publicOnly>{children}</SettingsProvider>;
}
