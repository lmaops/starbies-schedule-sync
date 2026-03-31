import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import AppFooter from '@/components/AppFooter'

export default function Privacy() {
  return (
    <div className="min-h-screen flex flex-col items-center bg-background p-6 gap-6 py-12">
      <h1
        className="text-4xl text-primary text-center"
        style={{ fontFamily: "'Dancing Script', cursive" }}
      >
        Privacy & your data
      </h1>

      <div className="max-w-2xl w-full bg-card border border-border rounded-2xl p-8 flex flex-col gap-8">

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">The short version</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is a small personal project, not a company. It stores the minimum data needed to
            log into your Starbucks partner hub, pull your schedule, and put it into a calendar
            feed. Nothing is sold, shared, or used for anything else.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">What's stored</h2>
          <ul className="text-sm text-muted-foreground leading-relaxed list-disc pl-5 flex flex-col gap-2">
            <li>
              <span className="font-medium text-foreground">Your email address:</span> used to
              log you in with a one-time PIN code. It's also how the app tells your account apart
              from others.
            </li>
            <li>
              <span className="font-medium text-foreground">Your Starbucks credentials:</span>
              your partner hub username, password, and security question answers. These are needed
              so the scraper can sign into partner hub on your behalf.
            </li>
            <li>
              <span className="font-medium text-foreground">Your work schedule:</span> shift
              dates, times, job title, location, and hours. This is what gets pulled from partner
              hub and turned into your calendar feed.
            </li>
            <li>
              <span className="font-medium text-foreground">Your timezone:</span> auto-detected
              from your browser so shift times display correctly.
            </li>
            <li>
              <span className="font-medium text-foreground">Scrape logs:</span> timestamps and
              status of each time the scraper ran for your account. If a scrape fails, error
              messages and screenshots of where it got stuck are saved to help with debugging.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">How credentials are protected</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your Starbucks username, password, and security answers are encrypted before they touch
            the database. Each user gets their own unique encryption key, and that key is itself
            encrypted by a master key that only the server knows. The encryption
            is AES-256-GCM - the same standard used by banks and password managers. Your
            credentials are only ever decrypted in memory, briefly, when the scraper needs to log in.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">How login works</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            There are no passwords for this site itself. When you log in, a 6-digit PIN is emailed
            to you. That PIN expires after 10 minutes and can only be tried 5 times. Once
            verified, a session cookie keeps you logged in for 90 days. The session token stored
            on the server is hashed so it can't be reversed.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Calendar feed link</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Your .ics calendar feed uses a long random token in the URL instead of requiring a
            login - that's how calendar apps like Google Calendar or Apple Calendar can read it.
            Anyone who has that link can see your schedule, so treat it like a password and don't
            share it publicly. You can regenerate the link from your settings if it ever leaks.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Cookies & tracking</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The only cookie used is your login session cookie. There are no analytics, no
            third-party trackers, no ads, and no fingerprinting. The server logs standard
            request information (IP address, timestamps) for rate limiting and abuse prevention,
            but these are not stored long-term or linked to your account.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Deleting your data</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You can delete your account from the settings page at any time. This permanently
            removes your email, encrypted credentials, all saved shifts, scrape history, and
            sessions from the database. There is no soft-delete or recovery period - it's gone
            immediately.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Where your data lives</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Everything is stored in a single SQLite database on the server that runs this app.
            There are no cloud databases, no third-party storage services, and no backups sent
            elsewhere. The database file lives on one machine.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">What this doesn't cover</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is a personal project with no legal team. This page is meant to be an honest
            explanation of what happens with your data, not a binding legal document. If you have
            questions or concerns, send an email to sss@liz.codes or PM liz_loves_brian on Reddit.
          </p>
        </section>

        <Link to="/" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          Back to Home
        </Link>
      </div>
      <AppFooter />
    </div>
  )
}
