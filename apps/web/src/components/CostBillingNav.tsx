import { NavLink } from 'react-router-dom';

const ITEMS = [
  { to: '/costs', label: 'Overview', end: true },
  { to: '/costs/usage', label: 'Actual usage' },
  { to: '/costs/budgets', label: 'Budgets & controls' },
  { to: '/costs/coverage', label: 'Coverage & data quality' },
  { to: '/costs/optimization', label: 'Optimization' },
];

export function CostBillingNav() {
  return <nav className="section-tabs" aria-label="Cost and billing sections">
    {ITEMS.map((item) => <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>)}
  </nav>;
}
