import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import loginPageImg from '@/assets/login_page.png'
import AppFooter from '@/components/AppFooter'

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 gap-6">
      <h1
        className="text-5xl text-primary text-center"
        style={{ fontFamily: "'Dancing Script', cursive" }}
      >
        Starbies Schedule Sync
      </h1>

      <div className="max-w-lg w-full bg-card border border-border rounded-2xl p-8 flex flex-col gap-7">
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">What is this?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This logs into your Starbucks partner hub and pulls your schedule automatically,
            then syncs it straight to a .ics link that you can drop into any calendar app.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Who's it for?</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            You must be able to access the schedule site linked{' '}
            <a href="https://starbucks-wfmr.jdadelivers.com/retail/portal" target="_blank" rel="noreferrer" className="text-primary hover:underline">here</a>
            {' '}using a login form that looks like this
          </p>
          <img src={loginPageImg} alt="Starbucks partner hub login page" className="rounded-xl border-2 border-border max-h-64 object-contain mx-auto" />
          <p className="text-sm text-muted-foreground leading-relaxed">
            Just provide your username, password, and security questions that you usually
            use to sign in and a virtual browser will do the busy work for you.
          </p>

        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-foreground">Heads up though:</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This is a personal project, not an official Starbucks thing. it works by logging
            into partner hub on your behalf, which means your credentials are stored on this
            server. Starbucks could also change their site and break things without warning.
            use it at your own risk - i do my best to keep it running but can't make any guarantees.
          </p>
        </section>

        <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
          Get Started
        </Link>
      </div>

      <AppFooter />
    </div>
  )
}
