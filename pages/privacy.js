// pages/privacy.js
// Privacy Policy para Hidrocom QBO Integrator

export default function Privacy() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6, color: '#1f2937' }}>
      <h1>Privacy Policy</h1>
      <p><strong>Last updated:</strong> May 12, 2026</p>

      <h2>1. Introduction</h2>
      <p>This Privacy Policy describes how Hidrocom S.A. (NIT 103183841) ("we", "us", "our") handles information collected through the Hidrocom QBO Integrator application ("the Application"), an internal integration tool used solely for synchronizing sales data from our internal operations platform (GasOps) to QuickBooks Online.</p>

      <h2>2. Scope</h2>
      <p>The Application is an internal tool used exclusively by Hidrocom S.A. employees and authorized personnel for accounting integration purposes. It is not offered to or used by external users or the general public.</p>

      <h2>3. Data Collected</h2>
      <p>The Application accesses and processes the following data through the QuickBooks Online API:</p>
      <ul>
        <li>Company information (name, accounts, classes, customers, items)</li>
        <li>Transactional sales data (Sales Receipts)</li>
        <li>OAuth authentication tokens</li>
      </ul>
      <p>All data processed corresponds to Hidrocom S.A.&apos;s own QuickBooks account.</p>

      <h2>4. Data Storage</h2>
      <p>OAuth tokens are stored securely in our Supabase database (encrypted at rest). Sales data is processed in transit only and stored in QuickBooks Online directly. No third-party services have access to this data.</p>

      <h2>5. Data Sharing</h2>
      <p>We do not share, sell, or distribute any data accessed through this Application with third parties. The Application is for internal use only.</p>

      <h2>6. Data Retention</h2>
      <p>OAuth tokens are retained until revoked. Transactional data is retained according to Guatemalan tax law requirements (minimum 5 years).</p>

      <h2>7. Security</h2>
      <p>The Application implements industry-standard security measures including OAuth 2.0 authentication, HTTPS encryption, environment-based secrets management, and audit logging.</p>

      <h2>8. Your Rights</h2>
      <p>As this is an internal application of Hidrocom S.A., access controls are managed internally. For questions about data handling, contact: shelloakland@hidrocom.net</p>

      <h2>9. Changes to this Policy</h2>
      <p>We may update this Privacy Policy from time to time. Updated versions will be posted at this URL.</p>

      <h2>10. Contact</h2>
      <p>Hidrocom S.A.<br/>NIT: 103183841<br/>Email: shelloakland@hidrocom.net<br/>Guatemala City, Guatemala</p>
    </div>
  )
}
