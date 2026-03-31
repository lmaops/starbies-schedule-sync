import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import IcsSubscribeLink from '@/components/IcsSubscribeLink'

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-none size-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  )
}

interface Props {
  icsUrl?: string | null
}

export default function CalendarTutorial({ icsUrl }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        className="text-xs text-primary hover:underline cursor-pointer bg-transparent border-none p-0 font-normal"
        onClick={() => setOpen(true)}
      >
        Not sure what to do with the .ical feed link? Click here for a quick and easy tutorial!
      </AlertDialogTrigger>
      <AlertDialogContent className="!max-w-md sm:!max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>How to subscribe</AlertDialogTitle>
          <AlertDialogDescription>
            Pick your calendar app below and follow the steps. Your schedule will stay up to date automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {icsUrl && <IcsSubscribeLink icsUrl={icsUrl} />}

        <Tabs defaultValue="iphone">
          <TabsList className="w-full">
            <TabsTrigger value="iphone">iPhone</TabsTrigger>
            <TabsTrigger value="mac">Mac</TabsTrigger>
            <TabsTrigger value="gcal-web">Google Calendar</TabsTrigger>
          </TabsList>

          <TabsContent value="iphone" className="space-y-3 pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Apple Calendar - iPhone</p>
            <Step n={1}>Tap the <strong>Copy</strong> button above to copy your feed URL.</Step>
            <Step n={2}>Open the <strong>Settings</strong> app on your iPhone.</Step>
            <Step n={3}>Scroll down and tap <strong>Calendar</strong> → <strong>Accounts</strong>.</Step>
            <Step n={4}>Tap <strong>Add Account</strong> → <strong>Other</strong> → <strong>Add Subscribed Calendar</strong>.</Step>
            <Step n={5}>Paste the URL you copied and tap <strong>Next</strong>.</Step>
            <Step n={6}>Tap <strong>Save</strong>. Your shifts will appear in the Calendar app!</Step>
          </TabsContent>

          <TabsContent value="mac" className="space-y-3 pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Apple Calendar - Mac</p>
            <Step n={1}>Click the <strong>Copy</strong> button above to copy your feed URL.</Step>
            <Step n={2}>Open <strong>Calendar</strong> on your Mac.</Step>
            <Step n={3}>In the menu bar, click <strong>File</strong> → <strong>New Calendar Subscription…</strong></Step>
            <Step n={4}>Paste the URL and click <strong>Subscribe</strong>.</Step>
            <Step n={5}>Choose how often to refresh (every day is a good choice) and click <strong>OK</strong>.</Step>
            <Step n={6}>Your shifts will now show in Calendar and sync to your other Apple devices!</Step>
          </TabsContent>

          <TabsContent value="gcal-web" className="space-y-3 pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Google Calendar</p>
            <Step n={1}>Click the <strong>Copy</strong> button above to copy your feed URL.</Step>
            <Step n={2}>Go to <strong>calendar.google.com</strong> in your browser.</Step>
            <Step n={3}>On the left sidebar, click the <strong>+</strong> next to "Other calendars".</Step>
            <Step n={4}>Select <strong>From URL</strong>.</Step>
            <Step n={5}>Paste the URL and click <strong>Add calendar</strong>.</Step>
            <Step n={6}>Done! Your shifts will appear on the calendar. Google refreshes subscribed calendars roughly every 12–24 hours.</Step>
          </TabsContent>
        </Tabs>

        <AlertDialogFooter>
          <AlertDialogCancel>Got it</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
