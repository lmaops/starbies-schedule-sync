package calendar

import (
	"fmt"
	"strings"
	"time"

	"github.com/liz/sbuxsync/internal/models"
)

const icsTimeFormat = "20060102T150405Z"

// produces an rfc 5545 vcalendar string for the given shifts
func GenerateICS(shifts []models.Shift) string {
	var b strings.Builder

	b.WriteString("BEGIN:VCALENDAR\r\n")
	b.WriteString("VERSION:2.0\r\n")
	b.WriteString("PRODID:-//sbuxsync//Partner Schedule//EN\r\n")
	b.WriteString("CALSCALE:GREGORIAN\r\n")
	b.WriteString("METHOD:PUBLISH\r\n")
	b.WriteString("X-WR-CALNAME:Starbucks Schedule\r\n")
	b.WriteString("X-WR-TIMEZONE:UTC\r\n")

	for _, sh := range shifts {
		uid := fmt.Sprintf("%s@sbuxsync", sh.ShiftIDExt)
		if sh.ShiftIDExt == "" {
			uid = fmt.Sprintf("%s@sbuxsync", sh.ID.String())
		}

		b.WriteString("BEGIN:VEVENT\r\n")
		b.WriteString("UID:" + uid + "\r\n")
		b.WriteString("DTSTART:" + sh.StartTime.UTC().Format(icsTimeFormat) + "\r\n")
		b.WriteString("DTEND:" + sh.EndTime.UTC().Format(icsTimeFormat) + "\r\n")
		b.WriteString("SUMMARY:" + escapeICS(sh.JobName) + "\r\n")
		if sh.Location != "" {
			b.WriteString("LOCATION:" + escapeICS(sh.Location) + "\r\n")
		}
		if sh.NetHours > 0 {
			b.WriteString(fmt.Sprintf("DESCRIPTION:Net hours: %.2f\r\n", sh.NetHours))
		}
		b.WriteString("DTSTAMP:" + time.Now().UTC().Format(icsTimeFormat) + "\r\n")
		b.WriteString("END:VEVENT\r\n")
	}

	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

func escapeICS(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}
