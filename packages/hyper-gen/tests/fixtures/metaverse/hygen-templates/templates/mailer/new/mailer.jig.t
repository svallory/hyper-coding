---
to: given/app/mailers/{{ name || 'unnamed-mailer' }}.js
---
@set('name', name || 'unnamed')
@set('Name', capitalize(name))
@set('message', message || 'unnamed')
@set('Message', capitalize(message))
const { Mailer } = require('hyperwork')

class {{ Name }} extends Mailer {
  static defaults = {
    from: 'acme <acme@acme.org>'
  }

  static send{{ Message }}(user) {
    // https://nodemailer.com/message/
    this.mail({
      to: user.email,
      template: '{{ message }}',
      locals: {
        bill: '$13'
      }
    })
  }
}

module.exports = {{ Name }}
