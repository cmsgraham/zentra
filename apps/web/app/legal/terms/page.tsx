import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service — Zentra',
  description: 'The rules for using Zentra.',
};

const EFFECTIVE_DATE = 'April 22, 2026';

export default function TermsOfServicePage() {
  return (
    <>
      <h1 className="text-3xl font-semibold mb-2" style={{ color: 'var(--ink-text)' }}>
        Terms of Service
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--ink-text-muted)' }}>
        Effective date: {EFFECTIVE_DATE}
      </p>

      <Section title="1. Acceptance of these terms">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) form a binding agreement between you and Zentra
          (&ldquo;Zentra&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) regarding your use of the Zentra application
          and website at <a href="https://usezentra.app" className="underline">usezentra.app</a> (collectively, the
          &ldquo;Service&rdquo;). By creating an account or otherwise using the Service, you agree to these Terms
          and to our <Link href="/legal/privacy" className="underline">Privacy Policy</Link>. If you do not agree,
          do not use the Service.
        </p>
      </Section>

      <Section title="2. Eligibility">
        <p>
          You must be at least 13 years old (or the minimum age required in your country) to use Zentra. If you
          use the Service on behalf of an organization, you represent that you have authority to bind that
          organization to these Terms.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You are responsible for keeping your login credentials confidential and for all activity that occurs
          under your account. Notify us immediately at
          {' '}<a href="mailto:security@usezentra.app" className="underline">security@usezentra.app</a> if you
          suspect unauthorized access. We strongly recommend enabling two-factor authentication.
        </p>
        <p>
          You may delete your account at any time from the Settings page. We may suspend or terminate accounts
          that violate these Terms, harm other users, or pose a security risk.
        </p>
      </Section>

      <Section title="4. Your content">
        <p>
          You retain all rights to the content you create in Zentra (tasks, notes, plans, etc.). You grant Zentra
          a limited, worldwide, royalty-free license to host, store, transmit, display, and process your content
          solely as needed to operate and improve the Service for you.
        </p>
        <p>
          You are responsible for your content and represent that you have all necessary rights to it, and that
          it does not violate any law or third-party right.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Use the Service for any unlawful, infringing, fraudulent, or harmful purpose.</li>
          <li>Upload malware, attempt to gain unauthorized access, probe vulnerabilities, or interfere with the integrity of the Service.</li>
          <li>Resell, sublicense, or commercially exploit the Service without our written permission.</li>
          <li>Use automated tools (scrapers, bots) to access the Service in ways that exceed normal human use.</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation.</li>
          <li>Reverse engineer, decompile, or attempt to extract source code, except as expressly permitted by law.</li>
        </ul>
      </Section>

      <Section title="6. AI features">
        <p>
          Zentra offers optional AI-assisted features (planning, calendar/shopping import, etc.). Output produced
          by these features may be inaccurate, incomplete, or unsuitable for your purpose. You are responsible
          for reviewing AI output before relying on it. AI features may use third-party providers as described
          in our <Link href="/legal/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="7. Service changes & availability">
        <p>
          We work hard to keep Zentra available but we do not guarantee uninterrupted access. We may modify,
          suspend, or discontinue any part of the Service at any time. We will give reasonable advance notice
          for material changes that affect paid features.
        </p>
      </Section>

      <Section title="8. Pricing & payments">
        <p>
          Zentra may offer free and paid plans. Paid plans, if applicable, will be described at the point of
          purchase along with their billing cycle and renewal terms. Unless otherwise stated, all fees are
          non-refundable except where required by law. We may change prices with at least 30 days&apos; notice
          before the next billing cycle.
        </p>
      </Section>

      <Section title="9. Third-party services">
        <p>
          The Service may link to or integrate with third-party services (e.g., Google sign-in, AI providers).
          Your use of those services is governed by their own terms and privacy policies. We are not responsible
          for third-party services.
        </p>
      </Section>

      <Section title="10. Intellectual property">
        <p>
          The Service, including its software, design, text, graphics, and trademarks, is owned by Zentra and
          its licensors and is protected by intellectual-property laws. We grant you a limited, non-exclusive,
          non-transferable, revocable license to use the Service for your personal or internal business purposes,
          subject to these Terms.
        </p>
      </Section>

      <Section title="11. Termination">
        <p>
          You may stop using the Service at any time and delete your account from Settings. We may suspend or
          terminate your access if you violate these Terms, if required by law, or to protect the Service or
          its users. Upon termination, your right to use the Service ends. Sections that by their nature should
          survive termination (e.g., ownership, disclaimers, limitation of liability, indemnity, governing law)
          will survive.
        </p>
      </Section>

      <Section title="12. Disclaimers">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR
          IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
          PURPOSE, NON-INFRINGEMENT, AND ACCURACY. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED,
          ERROR-FREE, OR COMPLETELY SECURE.
        </p>
      </Section>

      <Section title="13. Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, ZENTRA AND ITS AFFILIATES, OFFICERS, AND EMPLOYEES WILL NOT BE
          LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF
          PROFITS, DATA, USE, OR GOODWILL ARISING OUT OF OR IN CONNECTION WITH THE SERVICE. OUR TOTAL LIABILITY
          FOR ANY CLAIM ARISING FROM THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN
          THE TWELVE (12) MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) USD $50.
        </p>
      </Section>

      <Section title="14. Indemnification">
        <p>
          You agree to defend, indemnify, and hold harmless Zentra and its affiliates from and against any claims,
          damages, liabilities, costs, and expenses (including reasonable attorneys&apos; fees) arising out of or
          related to (a) your use of the Service, (b) your content, or (c) your violation of these Terms or any
          law or third-party right.
        </p>
      </Section>

      <Section title="15. Governing law & disputes">
        <p>
          These Terms are governed by the laws of the jurisdiction in which Zentra is established, without regard
          to its conflict-of-laws rules. Any dispute arising out of or relating to these Terms or the Service
          will be resolved exclusively in the competent courts of that jurisdiction, unless mandatory consumer
          protection law in your country provides otherwise.
        </p>
      </Section>

      <Section title="16. Changes to these terms">
        <p>
          We may update these Terms from time to time. If we make material changes, we will notify you by email
          or by a prominent notice in the Service before the changes take effect. By continuing to use the
          Service after the effective date of the updated Terms, you agree to the updated Terms.
        </p>
      </Section>

      <Section title="17. Contact">
        <p>
          Questions about these Terms? Email <a href="mailto:support@usezentra.app" className="underline">support@usezentra.app</a>.
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
