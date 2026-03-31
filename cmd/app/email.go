package main

import (
	"fmt"
	"net/smtp"
	"os"
	"strconv"
)

func isDevMode() bool {
	return os.Getenv("SMTP_HOST") == ""
}

func sendPINEmail(to, pin string) error {
	host := os.Getenv("SMTP_HOST")
	portStr := os.Getenv("SMTP_PORT")
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASS")
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = user
	}

	if host == "" {
		return nil
	}

	port, _ := strconv.Atoi(portStr)
	if port == 0 {
		port = 587
	}

	auth := smtp.PlainAuth("", user, pass, host)
	msg := fmt.Appendf(nil,
		"From: Starbies Schedule Sync <%s>\r\nTo: %s\r\nSubject: Your login PIN\r\n\r\nYour PIN is: %s\r\n\r\nIt expires in 10 minutes.\r\n",
		from, to, pin,
	)
	addr := fmt.Sprintf("%s:%d", host, port)
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}
