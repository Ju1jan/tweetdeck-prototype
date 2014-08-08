var tweetdeck = require('../lib/tweetdeck');
var utils = require('./../lib/utils');

var Promise = require('rsvp').Promise;
var React = require('react');
var DOM = React.DOM;

var SMSAuthChallengeView = require('./login/smsauthchallenge');
var MobileAppAuthChallengeView = require('./login/mobileappauthchallenge');
var UserPassView = require('./login/userpass');

module.exports = React.createClass({
  propTypes: {
    onLoginSuccess: React.PropTypes.func
  },

  getDefaultProps: function () {
    return {
      onLoginSuccess: function () {},
      mobileAuthRequestPollInterval: 5000,
      mobileAuthRequestLimit: 10,
      mobileAuthRequestCount: 0
    };
  },

  getInitialState: function () {
    return {
      inProgress: false,
      twoFactorChallenge: {}
    };
  },

  showLoginError: function (message) {
    this.setState({
      inProgress: false,
      loginMessage: message
    });
  },

  onLoginSubmit: function (username, password) {
    this.setState({
      inProgress: true
    });
    this.login(username, password)
      .then(this.props.onLoginSuccess, this.showLoginError);
  },

  login: function(username, password) {
    return tweetdeck
      .login(username, password)
      .then(this.handleLoginResponse);
  },

  /**
   * handleLoginResponse()
   * All login/2fa HTTP responses are handled through this single function, which will either
   * a) Indentify that further authentication is required for 2FA (response.twoFactorChallenge),
   * b) Identify and reject on upstream xAuth errors (response.xAuthError),
   * c) Identify and reject on tdapi errors (response.error),
   * d) resolve with a successful response (user object).
   */
  handleLoginResponse: function (response) {
    return new Promise(function (resolve, reject) {

      if (response.twoFactorChallenge) {
        if (response.twoFactorChallenge.viaSMSCode) {
          return this.authenticateViaSMSCode(response.twoFactorChallenge);
        }
        if (response.twoFactorChallenge.viaMobileApp) {
          return this.authenticateViaMobileApp(response.twoFactorChallenge);
        }
      }

      if (response.xAuthError && response.xAuthError.code) {
        return reject({ message: this.getXAuthErrorMessageForCode(response.xAuthError.code) });
      }

      else if (response.error) {
        return reject({ message: 'Code should deal with this error: ' + response.error });
      }

      return resolve(response);
    }.bind(this));
  },

  /**
   * authenticateViaSMSCode()
   * Waits for the user to enter SMS code, then sends for authentication.
   */
  authenticateViaSMSCode: function(twoFactorChallenge) {
    return this.getSMSCodeFromUser(twoFactorChallenge)
      .then(function (code) {
        return this.attemptTwoFactor( {code: code} )
          .then(this.handleLoginResponse);
      }.bind(this));
  },

  /**
   * authenticateViaMobileApp()
   * Polls the login endpoint every 2s waiting for the user to authenticate via the mobile app.
   * Rejects once mobileAuthRequestLimit is reached.
   */
  authenticateViaMobileApp: function (twoFactorChallenge) {
    return new Promise(function (resolve, reject) {

      this.setState({
        inProgress: false,
        twoFactorChallenge: twoFactorChallenge
      });

      var mobileAuthTimeout;
      if (this.props.mobileAuthRequestCount > this.props.mobileAuthRequestLimit) {
        clearTimeout(mobileAuthTimeout);
        return reject({ message: 'You took too long to authenticate via the mobile app' });
      }

      this.props.mobileAuthRequestCount += 1;
      mobileAuthTimeout = setTimeout(function () {
        this.attemptTwoFactor()
          .then(this.handleLoginResponse)
          .then(function(res) {
            return resolve(res);
          });
      }.bind(this), this.props.mobileAuthRequestPollInterval);
    }.bind(this));
  },

  getSMSCodeFromUser: function (twoFactorChallenge) {
    return new Promise(function (resolve, reject) {
      this.setState({
        inProgress: false,
        twoFactorChallenge: twoFactorChallenge,
        loginMessage: 'SMS code required.',
        onMobileCodeSubmit: function (code) {
          resolve(code);
        }
      });
    }.bind(this));
  },

  attemptTwoFactor: function(opts) {
    var opts = utils.defaults(opts, {
      requestId: this.state.twoFactorChallenge.requestId,
      userId: this.state.twoFactorChallenge.userId,
    });

    return tweetdeck.verifyTwoFactor(opts);
  },

  getXAuthErrorMessageForCode: function (code) {
    var xAuthErrors = {
      '32': 'User/pass incorrect',
      '236': 'SMS auth code incorrect'
    }
    var message;
    try {
      message = xAuthErrors[code.toString()]
    } catch (e) {
      message = 'Unknown xAuth error';
    }
    return message;
  },

  render: function () {
    if (this.state.inProgress) {
      return DOM.img({ src: 'static/imgs/spinner.gif' });
    }
    if (this.state.twoFactorChallenge.viaSMSCode) {
      return SMSAuthChallengeView({
        loginMessage: this.state.loginMessage,
        onSubmit: this.state.onMobileCodeSubmit
      });
    }
    if (this.state.twoFactorChallenge.viaMobileApp) {
      return MobileAppAuthChallengeView({});
    }

    return UserPassView({
      loginMessage: this.state.loginMessage,
      onSubmit: this.onLoginSubmit
    });
  }
});
