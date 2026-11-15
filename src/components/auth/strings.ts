/**
 * Every word the sign-in / sign-up screens show, in one place (user, 2026-11-03: releasing
 * worldwide) — a translation later is a copy of this object, not a hunt through the components.
 * Messages that name the email are functions. (Errors the server sends back are shown as they come;
 * the ones here are what's said when it sends none.)
 */
export const AUTH = {
  brand: {
    home: 'Shortcut home',
    title: ['Long videos in.', 'Scroll-stopping shorts out.'],
    lead: 'Turn any talk, podcast or stream into clips ready for Instagram Reels and YouTube Shorts.',
    fine: 'Free to start · No credit card',
    /**
     * The brand side's scenes (BrandScene): what the creator in each photo is saying, word by word;
     * the words from `pick[0]` up to (not including) `pick[1]` are the moment the AI picks; the
     * short's caption, its `key` word lit; the label on the moment; and the timeline under the
     * transcript — the 90 s around the moment (`window`) and the clip's length. (Examples, not quotes.)
     */
    scenes: [
      {
        words: ['Honestly,', 'the', 'biggest', 'mistake', 'new', 'creators', 'make', 'is', 'posting', 'without', 'a', 'hook.'],
        pick: [8, 12], caption: ['Posting', 'without', 'a', 'hook'], key: 3, moment: 'Hook', score: 92, time: '12:48', window: ['12:20', '13:50'], clip: '0:42',
      },
      {
        words: ['You', 'don’t', 'need', 'two', 'hours', 'in', 'the', 'gym.', 'Twenty', 'focused', 'minutes', 'is', 'enough.'],
        pick: [8, 13], caption: ['Twenty', 'focused', 'minutes'], key: 1, moment: 'Key insight', score: 89, time: '04:15', window: ['03:50', '05:20'], clip: '0:38',
      },
      {
        words: ['And', 'that’s', 'when', 'I', 'realised', 'the', 'camera', 'was', 'never', 'even', 'recording.'],
        pick: [5, 11], caption: ['The', 'camera', 'was', 'never', 'recording'], key: 4, moment: 'Funny moment', score: 95, time: '31:02', window: ['30:40', '32:10'], clip: '0:51',
      },
    ],
    transcript: 'Transcript',
    clipLength: (t: string) => `${t} clip`,
  },

  /** The slim bar above the card and the line below it (wide windows) */
  nav: {
    label: 'Shortcut',
    pricing: 'Pricing',
    // (the button that switches screens: on Sign in → Create account, and back)
    newHere: 'New here?', toSignup: 'Create account',
    haveAccount: 'Have an account?', toSignin: 'Sign in',
  },
  footer: {
    label: 'Legal and help',
    brand: 'Shortcut', company: 'Stoory Marketing Pvt. Ltd.',
    terms: 'Terms', privacy: 'Privacy', support: 'Support', contact: 'Contact',
  },

  tabs: { label: 'Sign in or create an account', signin: 'Sign in', signup: 'Create account' },

  signin: {
    title: 'Welcome back',
    sub: 'Your clips and edits are right where you left them.',
    submit: 'Sign in',
    busy: 'Signing in…',
    passwordPlaceholder: '••••••••',
  },
  signup: {
    title: 'Create your account',
    sub: 'Turn your first long video into shorts in minutes.',
    submit: 'Create account',
    busy: 'Creating your account…',
    passwordPlaceholder: 'Create a password',
    confirmPlaceholder: 'Type it again',
  },
  code: {
    back: 'Back',
    title: 'Check your email',
    sentTo: 'We sent a 6-digit code to',
    sentAfter: 'Enter it to finish — you’ll go straight in.',
    submit: 'Verify and continue',
    busy: 'Checking…',
    didntGet: 'Didn’t get it?',
    resendIn: (s: number) => `Send again in ${s}s`,
    resend: 'Send a new code',
    otherEmail: 'Use another email',
  },

  /** Forgot password → reset password (and the old code page, /verify-otp) */
  recovery: {
    brand: {
      title: ['Locked out?', 'Back in a minute.'],
      lead: 'We’ll email you a 6-digit code, then you choose a new password. Your clips stay right where they are.',
    },
    backToSignIn: 'Back to sign in',
    forgot: {
      title: 'Reset your password',
      sub: 'Enter the email you sign in with and we’ll send you a code.',
      submit: 'Send reset code',
      busy: 'Sending…',
      sentTitle: 'Check your email',
      sentBody: 'If there’s an account for',
      sentAfter: 'a 6-digit code is on its way. It can take a minute to arrive.',
      next: 'Enter reset code',
      otherEmail: 'Use another email',
    },
    reset: {
      title: 'Choose a new password',
      sub: 'Enter the code we emailed to',
      subNoCode: 'Choose a new password for',
      code: 'Reset code',
      password: 'New password',
      passwordPlaceholder: 'Create a password',
      submit: 'Update password',
      busy: 'Updating…',
      missingEmail: 'This page needs the email you’re resetting. Start again from “Forgot password?”.',
      startAgain: 'Start again',
    },
    verify: {
      title: 'Check your email',
      submit: 'Verify',
      busy: 'Verifying…',
      doneTitle: 'Email confirmed',
      doneBody: 'Your account is ready. Sign in to get started.',
      doneCta: 'Go to sign in',
    },
  },

  fields: {
    email: 'Email',
    emailPlaceholder: 'name@company.com',
    password: 'Password',
    confirm: 'Confirm password',
    code: 'Code',
    codeHint: '6-digit code',
    forgot: 'Forgot password?',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    capsLock: 'Caps Lock is on',
    rules: {
      label: 'Password needs',
      length: '8+ characters',
      upper: '1 uppercase',
      number: '1 number',
      met: '(done)',
      unmet: '(still needed)',
    },
  },

  legal: {
    before: 'By creating an account, you agree to our',
    terms: 'Terms',
    and: 'and',
    privacy: 'Privacy Policy',
    after: '.',
    secure: 'Secure sign-in',
  },

  google: {
    cta: 'Continue with Google',
    busy: 'Opening Google…',
    or: 'or use your email',
    denied: 'Google didn’t share a confirmed email for that account. Try another Google account, or use your email.',
    unavailable: 'Google sign-in isn’t available right now. Use your email and password, or try again later.',
    failed: 'Google sign-in didn’t finish. Try again.',
  },

  notes: {
    signedOutElsewhere: 'You were signed out because your account signed in on another device. One device can be signed in at a time.',
    noAccount: (email: string) => `There’s no account for ${email} yet — confirm your password and we’ll create it.`,
    newCodeSent: (email: string) => `A new code is on its way to ${email}.`,
    verifiedSignIn: 'Your email is confirmed and your account is ready. Sign in to continue.',
    passwordUpdated: 'Your password is updated. Sign in with your new one.',
  },
  errors: {
    generic: 'Something went wrong. Try again.',
    network: 'Something went wrong. Check your connection and try again.',
    googleOnly: 'This email signs in with Google — use Continue with Google. (Or set a password with “Forgot password?”)',
    wrongPassword: 'Wrong password. Try again, or reset it with “Forgot password?”',
    tooManyTries: 'Too many wrong tries. Wait 15 minutes, or reset your password with “Forgot password?”',
    mismatch: 'The passwords don’t match',
    weakPassword: 'Your password needs 8+ characters, 1 uppercase letter and 1 number.',
    exists: (email: string) => `You already have an account with ${email}. Enter its password to sign in, or reset it with “Forgot password?”`,
    createFailed: 'Could not create your account. Try again.',
    badCode: 'That code didn’t work. Try again.',
    resendFailed: 'Could not send a new code. Try again in a moment.',
    resetFailed: 'Could not update your password. Try again.',
  },
} as const
