import { DarkLayout, HockeyFooter } from '@/components/citrus2';
import Navbar from '@/components/Navbar';

const Privacy = () => {
  return (
    <DarkLayout>


      <Navbar />      <main className="relative max-w-[820px] mx-auto px-6 pt-16 pb-24">
        <div className="font-jbmono text-[10px] tracking-[0.32em] uppercase text-pastel-orange-soft mb-3 font-bold">
          Legal
        </div>
        <h1 className="font-sans font-black text-[2.5rem] md:text-[3.25rem] leading-tight tracking-[-0.03em] text-pastel-cream mb-3">
          Privacy Policy
        </h1>
        <p className="font-jbmono text-[11px] tracking-wider uppercase text-white/55 mb-12">Last Updated: February 18, 2026</p>

        <div className="prose prose-invert max-w-none space-y-6 text-white/75 prose-headings:text-pastel-cream prose-strong:text-pastel-cream prose-a:text-pastel-orange-soft hover:prose-a:text-pastel-orange">
            <p>
              <strong>Citrus Fantasy Hockey</strong> ("we," "our," or "us") is committed to protecting your privacy.
              This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use
              our mobile application and web service (collectively, the "Service").
            </p>
            <p><strong>By using our Service, you agree to the collection and use of information in accordance with this policy.</strong></p>

            <section>
              <h2 className="text-xl font-semibold mb-3">1. Information We Collect</h2>
              <h3 className="text-lg font-medium mb-2">1.1 Information You Provide to Us</h3>
              <p>We collect information that you voluntarily provide when using our Service:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Account Information:</strong> Email address, username, password (encrypted)</li>
                <li><strong>Profile Information:</strong> Display name, team name, avatar/logo (optional)</li>
                <li><strong>League Data:</strong> League names, team rosters, draft picks, transactions, matchup results</li>
                <li><strong>Communications:</strong> Messages you send through our support channels or in-app chat features</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">1.2 Automatically Collected Information</h3>
              <p>When you use our Service, we automatically collect certain information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Usage Data:</strong> Pages visited, features used, time spent in app, interaction patterns</li>
                <li><strong>Device Information:</strong> Device type, operating system, app version, unique device identifiers</li>
                <li><strong>Network Information:</strong> IP address, connection type, general location (country/region)</li>
                <li><strong>Performance Data:</strong> App crashes, errors, loading times (for improving service quality)</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">1.3 Third-Party NHL Data</h3>
              <p>
                We collect publicly available NHL player statistics and game data from official NHL sources to power our
                fantasy sports platform. This data includes player names, statistics, team affiliations, and game schedules.
                We are not affiliated with or endorsed by the National Hockey League (NHL).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">2. How We Use Your Information</h2>
              <p>We use the collected information for the following purposes:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Service Delivery:</strong> Provide, maintain, and improve our fantasy hockey platform</li>
                <li><strong>Account Management:</strong> Create and manage your account, authenticate users</li>
                <li><strong>League Operations:</strong> Process drafts, roster changes, scoring, matchups, and standings</li>
                <li><strong>Personalization:</strong> Customize your experience based on preferences and usage patterns</li>
                <li><strong>Communications:</strong> Send service updates, league notifications, and important announcements</li>
                <li><strong>Analytics:</strong> Understand how users interact with our Service to improve features</li>
                <li><strong>Security:</strong> Detect, prevent, and address fraud, abuse, and security issues</li>
                <li><strong>Legal Compliance:</strong> Comply with applicable laws, regulations, and legal processes</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">3. How We Share Your Information</h2>
              <p>We do not sell your personal information. We may share your information in the following limited circumstances:</p>

              <h3 className="text-lg font-medium mb-2 mt-4">3.1 With Other Users</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Your team name, roster, and league activity are visible to other members of your leagues</li>
                <li>League commissioners can view all team rosters and transactions within their leagues</li>
                <li>Your profile information (username, team name, avatar) is visible to league members</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">3.2 With Service Providers</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Supabase:</strong> Database and authentication services</li>
                <li><strong>Firebase:</strong> Hosting and performance monitoring</li>
                <li><strong>NHL API:</strong> Player statistics and game data (publicly available data only)</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">3.3 For Legal Reasons</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>To comply with legal obligations, court orders, or government requests</li>
                <li>To protect our rights, property, and safety, or that of our users</li>
                <li>To investigate and prevent fraud, security issues, or illegal activity</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">3.4 Business Transfers</h3>
              <p>If we are involved in a merger, acquisition, or sale of assets, your information may be transferred as part of that transaction. We will notify you of any such change.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">4. Data Retention</h2>
              <p>We retain your personal information for as long as necessary to provide our Service:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Active Accounts:</strong> Data retained while your account is active</li>
                <li><strong>Inactive Accounts:</strong> Data retained for 2 years after last login, then anonymized or deleted</li>
                <li><strong>Deleted Accounts:</strong> Personal data deleted within 30 days of account deletion request</li>
                <li><strong>Legal Requirements:</strong> Some data may be retained longer to comply with legal obligations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">5. Your Rights and Choices</h2>
              <p>You have the following rights regarding your personal information:</p>

              <h3 className="text-lg font-medium mb-2 mt-4">5.1 Access and Portability</h3>
              <p>You can access your account information at any time through the app's Settings page. You may request a copy of your data in a portable format.</p>

              <h3 className="text-lg font-medium mb-2 mt-4">5.2 Correction</h3>
              <p>You can update your account information (email, username, team name) through the Settings page.</p>

              <h3 className="text-lg font-medium mb-2 mt-4">5.3 Deletion</h3>
              <p>You can request deletion of your account and personal data through the Settings page. This will:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Permanently delete your account and authentication credentials</li>
                <li>Remove your personal information from active databases</li>
                <li>Anonymize your historical league data (team names become "Former Team")</li>
                <li>Complete within 30 days of request</li>
              </ul>

              <h3 className="text-lg font-medium mb-2 mt-4">5.4 Marketing Opt-Out</h3>
              <p>You can unsubscribe from promotional emails using the unsubscribe link in any marketing email. Service-related emails (password resets, league notifications) cannot be disabled.</p>

              <h3 className="text-lg font-medium mb-2 mt-4">5.5 Do Not Track</h3>
              <p>We do not track users across third-party websites. Our Service does not respond to Do Not Track signals as we do not engage in cross-site tracking.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">6. Data Security</h2>
              <p>We implement industry-standard security measures to protect your information:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Encryption:</strong> All data transmitted between your device and our servers is encrypted using HTTPS/TLS</li>
                <li><strong>Password Protection:</strong> Passwords are hashed using bcrypt before storage</li>
                <li><strong>Access Controls:</strong> Strict access controls limit who can access user data</li>
                <li><strong>Regular Audits:</strong> We conduct regular security audits and vulnerability assessments</li>
                <li><strong>Database Security:</strong> Supabase provides enterprise-grade database security with Row Level Security (RLS)</li>
              </ul>
              <p className="mt-2"><strong>However, no method of transmission over the Internet or electronic storage is 100% secure.</strong> While we strive to protect your personal information, we cannot guarantee absolute security.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">7. Children's Privacy</h2>
              <p><strong>Our Service is not intended for children under the age of 13.</strong> We do not knowingly collect personal information from children under 13. If you are a parent or guardian and believe your child has provided us with personal information, please contact us immediately, and we will delete such information from our systems.</p>
              <p>If you are between 13 and 18 years old, you may only use our Service with the involvement and consent of a parent or guardian.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">8. International Data Transfers</h2>
              <p>Your information may be transferred to and maintained on servers located outside of your state, province, country, or other governmental jurisdiction where data protection laws may differ.</p>
              <p>If you are located outside the United States and choose to use our Service, your information will be transferred to the United States. By using our Service, you consent to this transfer.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">9. California Privacy Rights (CCPA)</h2>
              <p>If you are a California resident, you have specific rights under the California Consumer Privacy Act (CCPA):</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Right to Know:</strong> You can request information about the personal data we collect and how we use it</li>
                <li><strong>Right to Delete:</strong> You can request deletion of your personal data (subject to legal exceptions)</li>
                <li><strong>Right to Opt-Out:</strong> We do not sell personal information, so there is nothing to opt-out of</li>
                <li><strong>Right to Non-Discrimination:</strong> We will not discriminate against you for exercising your CCPA rights</li>
              </ul>
              <p className="mt-2">To exercise these rights, contact us at <a href="mailto:privacy@citrusfantasy.com" className="text-green-700 hover:underline">privacy@citrusfantasy.com</a></p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">10. European Privacy Rights (GDPR)</h2>
              <p>If you are in the European Economic Area (EEA), you have rights under the General Data Protection Regulation (GDPR):</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Legal Basis:</strong> We process your data based on contract performance, legitimate interests, and consent</li>
                <li><strong>Right to Access:</strong> Request access to your personal data</li>
                <li><strong>Right to Rectification:</strong> Request correction of inaccurate data</li>
                <li><strong>Right to Erasure:</strong> Request deletion of your data ("right to be forgotten")</li>
                <li><strong>Right to Restrict Processing:</strong> Request limitation on how we process your data</li>
                <li><strong>Right to Data Portability:</strong> Receive your data in a machine-readable format</li>
                <li><strong>Right to Object:</strong> Object to processing based on legitimate interests</li>
                <li><strong>Right to Lodge a Complaint:</strong> File a complaint with your local data protection authority</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">11. Analytics, Cookies, and Tracking</h2>
              <p>We use analytics tools to understand how users interact with our Service:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Consent-Based Analytics:</strong> We use Firebase Analytics to collect anonymous usage data. Analytics is <strong>only activated after you explicitly grant consent</strong> via the cookie consent banner displayed on your first visit.</li>
                <li><strong>Your Choice:</strong> You can decline analytics tracking at any time. If you decline, no analytics cookies are set and no usage data is collected. You can change your preference by clearing your browser storage and revisiting the site.</li>
                <li><strong>What We Track (with consent):</strong> Page views, feature usage, and aggregate interaction patterns. We do not track individual keystrokes, form contents, or personally identifiable browsing behavior.</li>
                <li><strong>No Third-Party Advertising:</strong> We do not use advertising networks, remarketing pixels, or sell data to advertisers.</li>
                <li><strong>No Cross-Site Tracking:</strong> We do not track your activity outside our Service.</li>
                <li><strong>Essential Storage:</strong> We use localStorage for app functionality (authentication tokens, user preferences, consent choice). These are not tracking cookies and are required for the Service to function.</li>
                <li><strong>Performance Monitoring:</strong> Firebase Performance collects anonymous crash reports and loading times to help us improve reliability.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">12. Changes to This Privacy Policy</h2>
              <p>We may update this Privacy Policy from time to time. We will notify you of material changes by:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Posting the updated policy on this page with a new "Last Updated" date</li>
                <li>Sending an email notification to your registered email address</li>
                <li>Displaying an in-app notification upon your next login</li>
              </ul>
              <p className="mt-2"><strong>Your continued use of the Service after changes become effective constitutes acceptance of the updated Privacy Policy.</strong></p>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">13. Contact Us</h2>
              <div className="bg-muted dark:bg-muted p-4 rounded-lg">
                <p>If you have questions, concerns, or requests regarding this Privacy Policy or our data practices, please contact us:</p>
                <p className="mt-2">
                  <strong>Email:</strong> <a href="mailto:CitrusFantasySports@Gmail.com" className="text-green-700 hover:underline">CitrusFantasySports@Gmail.com</a><br />
                  <strong>Support:</strong> <a href="mailto:CitrusFantasySports@Gmail.com" className="text-green-700 hover:underline">CitrusFantasySports@Gmail.com</a>
                </p>
                <p className="mt-2"><strong>Response Time:</strong> We will respond to privacy requests within 30 days.</p>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold mb-3">14. Consent</h2>
              <p>By using our Service, you consent to our Privacy Policy and agree to its terms.</p>
            </section>
        </div>
      </main>
      <HockeyFooter />
    </DarkLayout>
  );
};

export default Privacy;
