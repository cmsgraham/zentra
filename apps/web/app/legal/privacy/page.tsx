import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Zentra',
  description: 'How Zentra collects, uses, and protects your personal data.',
};

const EFFECTIVE_DATE = 'April 22, 2026';

export default function PrivacyPolicyPage() {
  return (
    <>
      <h1 className="text-3xl font-semibold mb-2" style={{ color: 'var(--ink-text)' }}>
        Privacy Policy
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--ink-text-muted)' }}>
        Effective date: {EFFECTIVE_DATE}
      </p>

      <Section title="1. Who we are">
        <p>
          Zentra (&ldquo;Zentra&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;) is a personal productivity application
          accessible at <a href="https://usezentra.app" className="underline">usezentra.app</a>. This Privacy Policy
          explains how we collect, use, and safeguard your information when you use our service (the &ldquo;Service&rdquo;).
        </p>
        <p>
          For privacy questions, contact <a href="mailto:privacy@usezentra.app" className="underline">privacy@usezentra.app</a>.
        </p>
      </Section>

      <Section title="2. Information we collect">
        <p><strong>Account information.</strong> When you create an account we collect your name, email address, and a hashed password. If you sign in with Google, we receive your email, name, and Google account identifier.</p>
        <p><strong>Content you create.</strong> Tasks, notes, plans, focus sessions, reminders, shopping lists, brain dumps, and any other data you enter into Zentra.</p>
        <p><strong>Security data.</strong> Two-factor authentication secrets (encrypted at rest), password reset and email verification tokens, and recovery codes (encrypted at rest).</p>
        <p><strong>Technical data.</strong> IP address, browser type, device type, timestamps, and minimal server logs needed to operate and secure the Service.</p>
        <p><strong>Cookies & local storage.</strong> We use first-party cookies and browser storage to keep you signed in, remember your theme/preferences, and synchronize state across windows. We do not use third-party advertising or tracking cookies.</p>
        <p>We do <strong>not</strong> knowingly collect data from children under 13.</p>
      </Section>

      <Section title="3. How we use your information">
        <ul className="list-disc pl-6 space-y-1">
          <li>Provide, maintain, and improve the Service.</li>
          <li>Authenticate you and protect your account (including 2FA and Google sign-in).</li>
          <li>Send transactional email — verification codes, password resets, security notifications.</li>
          <li>Detect, prevent, and respond to fraud, abuse, or security incidents.</li>
          <li>Comply with legal obligations.</li>
        </ul>
        <p>We do <strong>not</strong> sell your personal data and we do <strong>not</strong> use your content to train third-party AI models without your explicit, opt-in consent.</p>
      </Section>

      <Section title="4. Optional AI features">
        <p>
          Some features (such as AI-assisted planning, calendar extraction, or shopping import) send the relevant
          content you submit to our AI processing providers solely to generate the requested output. These calls
          do not include your account credentials, and we instruct our providers not to retain your inputs for model
          training. You can choose not to use these features.
        </p>
      </Section>

      <Section title="5. Google sign-in">
        <p>
          When you choose &ldquo;Continue with Google&rdquo;, we receive your basic profile (name, email, profile picture)
          and a Google account identifier so we can recognize you on return visits. We never receive your Google
          password and we never request access to your Gmail, Drive, Calendar, or any other Google service.
        </p>
        <p>
          Zentra&apos;s use and transfer of information received from Google APIs adheres to the
          {' '}<a href="https://developers.google.com/terms/api-services-user-data-policy" className="underline" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>,
          including the Limited Use requirements.
        </p>
      </Section>

      <Section title="6. How we share information">
        <p>We share personal data only with:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Service providers</strong> who host our infrastructure (cloud server, database, object storage) and send our transactional email — bound by confidentiality and data-protection terms.</li>
          <li><strong>Legal authorities</strong> when required by valid legal process, or to protect the rights, safety, or property of Zentra, our users, or the public.</li>
          <li><strong>Successors</strong> in the event of a merger, acquisition, or asset sale; you will be notified before your data becomes subject to a different privacy policy.</li>
        </ul>
        <p>We do not sell or rent your personal data to anyone.</p>
      </Section>

      <Section title="7. Data security">
        <p>
          We use industry-standard safeguards including TLS in transit, password hashing with bcrypt, AES-256-GCM
          encryption for 2FA secrets and recovery codes, signed session tokens, and access controls on our infrastructure.
          No system is perfectly secure; if you discover a vulnerability please email
          {' '}<a href="mailto:security@usezentra.app" className="underline">security@usezentra.app</a>.
        </p>
      </Section>

      <Section title="8. Data retention">
        <p>
          We keep your account data while your account is active. If you delete your account, we delete your
          personal data within 30 days, except where retention is required by law or to resolve disputes and
          enforce our agreements. Backups are purged on a rolling schedule.
        </p>
      </Section>

      <Section title="9. Your rights">
        <p>Depending on where you live, you may have the right to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Access, correct, or download a copy of your personal data.</li>
          <li>Delete your account and associated data.</li>
          <li>Object to or restrict certain processing.</li>
          <li>Withdraw consent for optional features at any time.</li>
          <li>Lodge a complaint with your local data-protection authority.</li>
        </ul>
        <p>
          To exercise these rights, email <a href="mailto:privacy@usezentra.app" className="underline">privacy@usezentra.app</a>.
        </p>
      </Section>

      <Section title="10. International transfers">
        <p>
          Zentra is operated from the United States. If you access the Service from outside the US, your data
          will be transferred to and processed in the US (and any other location where our service providers
          operate), which may have different data-protection laws than your country.
        </p>
      </Section>

      <Section title="11. Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. If we make material changes, we will notify you
          by email or by a prominent notice in the Service before the changes take effect. The &ldquo;Effective date&rdquo;
          at the top reflects the most recent revision.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions or requests? Email <a href="mailto:privacy@usezentra.app" className="underline">privacy@usezentra.app</a>.
        </p>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--ink-text)' }}>{title}</h2>
      <div className="space-y-3 text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
        {children}
      </div>
    </section>
  );
}
