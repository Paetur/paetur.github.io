window.WEDDING_TRANSLATIONS = {
    fo: {
        invite: 'Vit skulu giftast',
        welcome: 'Vit gleða okkum at hátíðarhalda dagin saman við tykkum í Týsklandi.',
        answer: 'Svar upp á innbjóðing',
        dear: 'Góðu gestir',
        who: 'Vinarliga sigið okkum, hvør kemur.',
        coming: 'Vit koma',
        notcoming: 'Vit kunnu tíverri ikki koma',
        bring: 'Taka við',
        help: 'Kanst tú taka okkurt við?',
        helptext: 'Vel bara, um tað passar tær. Tað, sum longu er valt, verður ikki tøkt hjá øðrum.',
        invited: 'Innbjóðingin er til',
        loading: 'Lesi innbjóðing…',
        invalid: 'Vit funnu ikki hesa innbjóðingina.',
        missing: 'Opna persónliga innbjóðingarleinkið fyri at síggja RSVP.',
        rsvpNote: 'Vinarliga sigið okkum, hvør kemur.',
        foodSoon: 'Vel tað, sum tit hava hug at taka við.',

        yourFood: 'Tað, tit taka við',
        availableFood: 'Tøkt at taka við',
        releaseFood: 'Tak aftur',
        available: 'tøkt',

        confirmClaim: 'Vilt tú taka "{name}" við?',
        confirmRelease: 'Vilt tú taka "{name}" aftur av listanum?',

        foodSaved: 'Takk! Hetta er nú skrásett.',
        foodTaken: 'Onkur annar hevur júst valt hetta. Vinarliga vel okkurt annað.',
        genericError: 'Okkurt gekk galið. Royn aftur.',

        selectGuest: 'Vel í minsta lagi ein persón.',

        rsvpComingSaved:
            'Takk fyri svarið. Vit gleða okkum at síggja tykkum!',

        rsvpDeclinedSaved:
            'Takk fyri, at tit góvu okkum boð.'
    },

    en: {
        invite: 'We are getting married',
        welcome: 'We look forward to celebrating our day with you in Germany.',
        answer: 'Reply to the invitation',
        dear: 'Dear guests',
        who: 'Please let us know who will be joining us.',
        coming: 'We are coming',
        notcoming: 'Sadly, we cannot come',
        bring: 'Bring along',
        help: 'Could you bring something?',
        helptext: 'Choose only if it suits you. Once claimed, an item will no longer be available to others.',
        invited: 'This invitation is for',
        loading: 'Loading invitation…',
        invalid: 'We could not find this invitation.',
        missing: 'Open your personal invitation link to see the RSVP.',
        rsvpNote: 'Please let us know who will be joining us.',
        foodSoon: 'Choose anything you would like to bring.',

        yourFood: 'What you are bringing',
        availableFood: 'Available to bring',
        releaseFood: 'Remove',
        available: 'available',

        confirmClaim: 'Would you like to bring "{name}"?',
        confirmRelease: 'Would you like to remove "{name}" from your list?',

        foodSaved: 'Thank you! This has now been registered.',
        foodTaken: 'Someone else has just chosen this. Please choose something else.',
        genericError: 'Something went wrong. Please try again.',

        selectGuest: 'Please select at least one person.',

        rsvpComingSaved:
            'Thank you for your reply. We look forward to seeing you!',

        rsvpDeclinedSaved:
            'Thank you for letting us know.'
    },

    de: {
        invite: 'Wir heiraten',
        welcome: 'Wir freuen uns darauf, diesen besonderen Tag mit euch in Deutschland zu feiern.',
        answer: 'Auf die Einladung antworten',
        dear: 'Liebe Gäste',
        who: 'Bitte sagt uns, wer mitfeiern wird.',
        coming: 'Wir kommen',
        notcoming: 'Leider können wir nicht kommen',
        bring: 'Mitbringen',
        help: 'Könnt ihr etwas mitbringen?',
        helptext: 'Wählt nur etwas aus, wenn es für euch passt. Bereits ausgewählte Dinge sind für andere nicht mehr verfügbar.',
        invited: 'Diese Einladung ist für',
        loading: 'Einladung wird geladen…',
        invalid: 'Wir konnten diese Einladung nicht finden.',
        missing: 'Öffnet euren persönlichen Einladungslink, um die RSVP zu sehen.',
        rsvpNote: 'Bitte sagt uns, wer mitfeiern wird.',
        foodSoon: 'Wählt gerne etwas aus, das ihr mitbringen möchtet.',

        yourFood: 'Das bringt ihr mit',
        availableFood: 'Noch verfügbar',
        releaseFood: 'Zurücknehmen',
        available: 'verfügbar',

        confirmClaim: 'Möchtet ihr "{name}" mitbringen?',
        confirmRelease: 'Möchtet ihr "{name}" wieder von eurer Liste entfernen?',

        foodSaved: 'Vielen Dank! Das ist jetzt eingetragen.',
        foodTaken: 'Jemand anderes hat dies gerade ausgewählt. Bitte wählt etwas anderes.',
        genericError: 'Etwas ist schiefgegangen. Bitte versucht es erneut.',

        selectGuest: 'Bitte wählt mindestens eine Person aus.',

        rsvpComingSaved:
            'Vielen Dank für eure Antwort. Wir freuen uns auf euch!',

        rsvpDeclinedSaved:
            'Vielen Dank für eure Rückmeldung.'
    }
};


/*
 * Alias used by invitation.js.
 * Both names point to the same translation object.
 */
window.tr = window.WEDDING_TRANSLATIONS;


/*
 * Current language.
 */
window.currentLanguage = 'fo';


/*
 * Change language for static page content.
 */
window.setLanguage = function (language) {
    if (!window.WEDDING_TRANSLATIONS[language]) {
        language = 'fo';
    }

    window.currentLanguage = language;

    document.documentElement.lang = language;

    // Language buttons
    document.querySelectorAll('[data-lang]').forEach(button => {
        button.classList.toggle(
            'on',
            button.dataset.lang === language
        );
    });

    // Static translated elements
    document.querySelectorAll('[data-t]').forEach(element => {
        const key = element.dataset.t;

        const translation =
            window.WEDDING_TRANSLATIONS[language]?.[key];

        if (translation) {
            element.textContent = translation;
        }
    });
};


/*
 * Manual FO / EN / DE buttons.
 */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-lang]').forEach(button => {
        button.addEventListener('click', async () => {
            const language = button.dataset.lang;

            window.setLanguage(language);

            /*
             * Re-render dynamic food content too.
             */
            if (typeof loadMyFood === 'function') {
                await loadMyFood();
            }

            if (typeof loadFood === 'function') {
                await loadFood();
            }
        });
    });
});