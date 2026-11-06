// Demo data so a reviewer can try the Claude flow immediately. Fictional candidate.
import * as db from './db.js';
import * as core from './core.js';

export async function seedIfEmpty() {
  if (process.env.NO_SEED) return;
  const existing = await db.get('profile', 'me');
  if (existing) return;
  await core.saveProfile({
    name: 'Aarav Mehta',
    headline: 'Product Manager — B2B SaaS & Payments',
    email: 'aarav.mehta@example.com',
    phone: '+91 98765 43210',
    location: 'Bengaluru, India',
    links: [
      { label: 'LinkedIn', url: 'https://linkedin.com/in/aarav-mehta-demo' },
      { label: 'GitHub', url: 'https://github.com/aarav-demo' },
    ],
    summary: 'Product manager with 4 years across B2B SaaS and fintech. Shipped integrations, onboarding and payments products used by 2,000+ businesses. Former engineer, comfortable with APIs, SQL and data.',
    instructions: 'Keep my resume to one page. Always quantify impact where the profile has numbers. Never drop my PayLane experience. Prefer action verbs; no "responsible for".',
    experience: [
      { role: 'Product Manager', company: 'PayLane (Series B fintech)', location: 'Bengaluru', start: 'Mar 2023', end: 'Present', domains: 'fintech, payments, integrations',
        details: 'Owned the accounting integrations squad (Tally, Zoho Books, QuickBooks, NetSuite). Launched 2-way sync with Zoho Books; adoption 38% of paying customers in 6 months; cut month-end reconciliation time from ~3 days to 4 hours for finance teams. Built a public integrations API + webhooks; 60+ customers built on it. Ran 40+ customer interviews with CFOs/finance managers. Led a team of 6 engineers + 1 designer. Reduced integration-related support tickets 45% by adding sync-status dashboard and error explanations. Worked with sales on 12 enterprise deals where integrations were the blocker; helped close ₹3.2Cr ARR. Learned: how finance teams actually close books, ERP data models, prioritising with revenue impact.' },
      { role: 'Associate Product Manager', company: 'Kitesheet (SMB SaaS)', location: 'Remote', start: 'Jul 2021', end: 'Feb 2023', domains: 'SaaS, onboarding, growth',
        details: 'Redesigned self-serve onboarding; activation went from 22% to 35%. Ran 15 A/B tests on signup and pricing page. Built a product analytics stack with Mixpanel + SQL dashboards used by the whole company. Launched CSV/Google Sheets import, used by 70% of new accounts. Wrote PRDs, ran sprint planning for a 5-person pod. Learned experimentation, writing crisp specs.' },
      { role: 'Software Engineer', company: 'Infocraft Systems', location: 'Pune', start: 'Jul 2019', end: 'Jun 2021', domains: 'backend, APIs',
        details: 'Built REST APIs in Node.js and PostgreSQL for a logistics client handling 1M+ requests/day. Integrated 3rd-party payment gateways (Razorpay, PayU). Reduced API p95 latency 40% via caching. Mentored 2 interns.' },
      { role: 'Product Intern', company: 'CampusKart (student startup)', location: 'Pune', start: 'Jan 2019', end: 'May 2019', domains: 'marketplace, consumer',
        details: 'Ran user research with 50 students; launched a referral program that drove 1,200 signups in 8 weeks.' },
    ],
    education: [
      { degree: 'B.Tech, Computer Engineering', school: 'College of Engineering, Pune', start: '2015', end: '2019', details: 'CGPA 8.4/10. Final-year project: UPI-based expense splitter app.' },
    ],
    achievements: [
      { title: 'PayLane "Builder of the Year" 2024', details: 'Company-wide award for integrations launch.' },
      { title: 'Winner, Smart India Hackathon 2018', details: 'Built a rural credit-scoring prototype; 1st of 120 teams.' },
    ],
    certifications: [
      { title: 'Product Analytics Certification', issuer: 'Mixpanel', year: '2022' },
      { title: 'AWS Cloud Practitioner', issuer: 'Amazon Web Services', year: '2020' },
    ],
    skills: [
      { group: 'Product', items: ['PRDs', 'Discovery & user interviews', 'A/B testing', 'Roadmapping', 'Pricing'] },
      { group: 'Technical', items: ['REST APIs', 'Webhooks', 'SQL', 'Node.js', 'PostgreSQL', 'Postman'] },
      { group: 'Tools', items: ['Jira', 'Figma', 'Mixpanel', 'Metabase', 'Notion'] },
      { group: 'Domain', items: ['Accounting/ERP integrations', 'Payments', 'B2B SaaS', 'Spend management'] },
    ],
    projects: [
      { title: 'Open-source Tally-to-JSON exporter', details: '300+ GitHub stars; used by finance teams to move Tally data into BI tools.', link: 'https://github.com/aarav-demo/tally-json' },
    ],
  });
  await core.createJob({
    title: 'Product Manager — Integrations',
    company: 'Spendwise (demo)',
    jd_text: `About the role
Spendwise is a spend management platform for finance teams across APAC. We're hiring a Product Manager to own our Integrations product — the connectors that sync cards, bills, reimbursements and approvals into customers' accounting systems (Xero, NetSuite, QuickBooks, Tally, Zoho Books).

What you'll do
• Own the roadmap for accounting and ERP integrations end to end
• Talk to finance managers and CFOs every week to understand month-end close pain
• Work with engineering on sync reliability, error handling and API design
• Partner with sales and customer success on enterprise deals where integrations are a blocker
• Define and track metrics: integration adoption, sync success rate, support ticket volume

What we're looking for
• 3+ years of product management experience in B2B SaaS, ideally fintech
• Strong technical fluency: APIs, webhooks, data models; engineering background a plus
• Experience shipping integrations with third-party platforms
• Data-driven: comfortable with SQL and dashboards
• Excellent written communication — you write crisp PRDs
Nice to have: experience with accounting concepts (chart of accounts, reconciliation), startup experience.`,
  });
  console.log('Seeded demo profile + job #1');
}
