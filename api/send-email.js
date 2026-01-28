import { Resend } from 'resend';

const resend = new Resend('re_D4yZdtyE_5YHEfmZEK7x1MuoXGWJHzr9D');

resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'santosbogo@gmail.com',
  subject: 'Hello World',
  html: '<p>Congrats on sending your <strong>first email</strong>!</p>'
});