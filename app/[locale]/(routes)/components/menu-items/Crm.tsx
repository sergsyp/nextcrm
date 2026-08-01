import { Coins } from "lucide-react";
import { NavItem } from "../nav-main";

/**
 * CRM Module Menu Item - Task Group 2.3
 *
 * Converted from DropdownMenu pattern to collapsible sidebar group.
 * Returns a NavItem object with sub-items for all CRM routes.
 *
 * @param localizations - Localized labels for CRM module items
 * @returns NavItem object with collapsible sub-items for CRM navigation
 */

type Props = {
  localizations: {
    title: string;
    accounts: string;
    contacts: string;
    leads: string;
    opportunities: string;
    contracts: string;
    products: string;
    dashboard?: string;
    myDashboard?: string;
    overview?: string;
    approvals?: string;
  };
  /** Current user's role — the Approvals queue is manager/admin only. */
  role?: string;
};

export const getCrmMenuItem = ({ localizations, role }: Props): NavItem => {
  return {
    title: localizations.title,
    icon: Coins,
    items: [
      {
        title: localizations.dashboard ?? "Dashboard",
        url: "/crm/dashboard",
      },
      {
        title: localizations.myDashboard ?? "My Dashboard",
        url: "/crm/dashboard/user",
      },
      {
        title: localizations.overview ?? "Overview",
        url: "/crm",
      },
      {
        title: localizations.accounts,
        url: "/crm/accounts",
      },
      {
        title: localizations.contacts,
        url: "/crm/contacts",
      },
      {
        title: localizations.leads,
        url: "/crm/leads",
      },
      {
        title: localizations.opportunities,
        url: "/crm/opportunities",
      },
      {
        title: localizations.contracts,
        url: "/crm/contracts",
      },
      {
        title: localizations.products,
        url: "/crm/products",
      },
      ...(role === "manager" || role === "admin"
        ? [{ title: localizations.approvals ?? "Approvals", url: "/crm/approvals" }]
        : []),
    ],
  };
};

export default getCrmMenuItem;
