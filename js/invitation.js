let currentInvitation = null;
let currentInviteCode = null;


/* -------------------------------------------------------
   TRANSLATIONS
------------------------------------------------------- */

function text(key, replacements = {}) {
    const language =
    window.currentLanguage ||
    currentInvitation?.language ||
    'fo';

    let value =
        tr[language]?.[key] ||
        tr.fo?.[key] ||
        key;

    Object.entries(replacements).forEach(([name, replacement]) => {
        value = value.replace(`{${name}}`, replacement);
    });

    return value;
}


/* -------------------------------------------------------
   INVITATION
------------------------------------------------------- */

async function loadInvitation() {
    const query = window.location.search.substring(1).trim();

    if (query.toLowerCase().startsWith('invite=')) {
        currentInviteCode = query.substring(7);
    } else {
        currentInviteCode = query;
    }

    currentInviteCode = decodeURIComponent(currentInviteCode)
        .trim()
        .toUpperCase();

    if (!currentInviteCode || currentInviteCode.length !== 8) {
        currentInviteCode = null;
        console.log('No valid invite code in URL');
        return;
    }

    const { data, error } = await db.rpc('get_invitation', {
        p_invite_code: currentInviteCode
    });

    if (error) {
        console.error('Supabase error:', error);
        return;
    }

    if (!data) {
        console.log('Invitation not found');
        return;
    }

    currentInvitation = data;

    if (data.language && typeof setLanguage === 'function') {
        setLanguage(data.language);
    }

    renderInvitation(data);
}

function renderInvitation(invitation) {
    // Invitation-only controls are hidden on the generic landing page
    // and shown only after a valid invite code has loaded successfully.
    document.getElementById('rsvp')?.classList.remove('hidden');
    document.getElementById('scrollToRsvp')?.classList.remove('hidden');

    const invitee = document.getElementById('invitee');
    if (invitee && invitation.household_name) {
        invitee.textContent = invitation.household_name;
        invitee.classList.remove('hidden');
    }

    const householdName =
        document.getElementById('household-name');

    if (householdName) {
        householdName.textContent =
            invitation.household_name;
    }

    const guestList =
        document.getElementById('guest-list');

    if (!guestList) return;

    guestList.innerHTML = '';

    invitation.guests.forEach(guest => {
        const label =
            document.createElement('label');

        label.className = 'choice';

        const checkbox =
            document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.value = guest.id;
        checkbox.dataset.guestId = guest.id;

        checkbox.checked =
            guest.rsvp_status === 'attending';

        const guestName =
            document.createTextNode(
                ` ${guest.first_name}${
                    guest.last_name
                        ? ' ' + guest.last_name
                        : ''
                }`
            );

        label.appendChild(checkbox);
        label.appendChild(guestName);

        guestList.appendChild(label);
    });
}


/* -------------------------------------------------------
   RSVP
------------------------------------------------------- */

async function saveRsvp(attending) {
    if (!currentInvitation || !currentInviteCode) {
        alert(text('genericError'));
        return;
    }

    let selectedGuestIds = [];

    if (attending) {
        selectedGuestIds = Array.from(
            document.querySelectorAll(
                '#guest-list input[type="checkbox"]:checked'
            )
        ).map(input => input.dataset.guestId);

        if (selectedGuestIds.length === 0) {
            alert(text('selectGuest'));
            return;
        }
    }

    const buttons =
        document.querySelectorAll('.rsvp-button');

    buttons.forEach(button => {
        button.disabled = true;
    });

    const { data, error } = await db.rpc(
        'save_rsvp',
        {
            p_invite_code: currentInviteCode,
            p_guest_ids: selectedGuestIds,
            p_attending: attending
        }
    );

    buttons.forEach(button => {
        button.disabled = false;
    });

    if (error) {
        console.error('RSVP error:', error);
        alert(text('genericError'));
        return;
    }

    console.log('RSVP saved:', data);

    const message =
        document.getElementById('rsvp-message');

    if (message) {
        message.textContent = attending
            ? text('rsvpComingSaved')
            : text('rsvpDeclinedSaved');

        message.classList.remove('hidden');
    }

    await loadInvitation();
}


/* -------------------------------------------------------
   CLAIM FOOD
------------------------------------------------------- */

async function claimFood(foodItemId) {
    if (!currentInviteCode) {
        alert(text('genericError'));
        return false;
    }

    const { data, error } = await db.rpc(
        'claim_food',
        {
            p_invite_code: currentInviteCode,
            p_food_item_id: foodItemId,
            p_quantity: 1
        }
    );

    if (error) {
        console.error('Food claim error:', error);

        if (
            error.message &&
            error.message.includes(
                'Not enough quantity available'
            )
        ) {
            alert(text('foodTaken'));
        } else {
            alert(text('genericError'));
        }

        return false;
    }

    console.log('Food claimed:', data);

    return true;
}


/* -------------------------------------------------------
   AVAILABLE FOOD
------------------------------------------------------- */

async function loadFood() {
    // Food is invitation-only. Never expose or activate it on the generic landing page.
    if (!currentInvitation || !currentInviteCode) {
        document.getElementById('foodSection')?.classList.add('hidden');
        return;
    }

    const { data, error } = await db.rpc('get_available_food');

    if (error) {
        console.error('Food error:', error);
        return;
    }

    const foodSection = document.getElementById('foodSection');
    const foodGrid = document.getElementById('foodgrid');
    if (!foodSection || !foodGrid) return;

    foodGrid.innerHTML = '';
    if (!data || data.length === 0) {
        foodSection.classList.add('hidden');
        return;
    }

    const language = window.currentLanguage || currentInvitation?.language || 'fo';
    const fallbackCategory = language === 'de' ? 'Sonstiges' : language === 'en' ? 'Other' : 'Annað';
    const groups = new Map();

    data.forEach(item => {
        const category = String(item.category || '').trim() || fallbackCategory;
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(item);
    });

    groups.forEach((items, category) => {
        const group = document.createElement('details');
        group.className = 'food-category tree-node';
        group.open = true;

        const summary = document.createElement('summary');
        const categoryName = document.createElement('strong');
        categoryName.textContent = category;
        const count = document.createElement('span');
        count.className = 'tree-count';
        count.textContent = `${items.length}`;
        summary.append(categoryName, count);

        const children = document.createElement('div');
        children.className = 'food-category-children tree-children';

        items.forEach(item => {
            const name = item[`name_${language}`] || item.name_fo;
            const description = item[`description_${language}`] || item.description_fo || '';
            const label = document.createElement('label');
            label.className = 'choice food-choice';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.foodId = item.id;
            checkbox.addEventListener('change', async () => {
                if (!checkbox.checked) return;
                checkbox.disabled = true;
                const success = await claimFood(item.id);
                if (!success) {
                    checkbox.checked = false;
                    checkbox.disabled = false;
                    return;
                }
                await loadMyFood();
                await loadFood();
            });

            const content = document.createElement('span');
            content.className = 'food-choice-content';
            const title = document.createElement('strong');
            title.textContent = name;
            const info = document.createElement('small');
            info.textContent = `${description ? description + ' · ' : ''}${item.quantity_available} ${text('available')}`;
            content.append(title, info);
            label.append(checkbox, content);
            children.appendChild(label);
        });

        group.append(summary, children);
        foodGrid.appendChild(group);
    });

    foodSection.classList.remove('hidden');
}

/* -------------------------------------------------------
   MY FOOD
------------------------------------------------------- */

async function loadMyFood() {
    if (!currentInviteCode) return;

    const { data, error } = await db.rpc(
        'get_my_food_claims',
        {
            p_invite_code: currentInviteCode
        }
    );

    if (error) {
        console.error('My food error:', error);
        return;
    }

    const section =
        document.getElementById('myFoodSection');

    const container =
        document.getElementById('myFood');

    if (!section || !container) return;

    container.innerHTML = '';

    if (!data || data.length === 0) {
        section.classList.add('hidden');
        return;
    }

    const language =
        window.currentLanguage ||
        currentInvitation?.language ||
        'fo';
        
    data.forEach(item => {
        const name =
            item[`name_${language}`] ||
            item.name_fo;

        const row =
            document.createElement('div');

        row.className = 'food claimed-food';

        // Do NOT call this variable "text".
        // That would shadow our text() translation function.
        const itemText =
            document.createElement('span');

        itemText.textContent =
            `✓ ${name}${
                item.quantity > 1
                    ? ` × ${item.quantity}`
                    : ''
            }`;

        const button =
            document.createElement('button');

        button.type = 'button';
        button.className = 'linkbtn';
        button.textContent =
            text('releaseFood');

        button.addEventListener(
            'click',
            async () => {
                button.disabled = true;

                const success =
                    await releaseFood(
                        item.food_item_id
                    );

                if (success) {
                    await loadMyFood();
                    await loadFood();
                } else {
                    button.disabled = false;
                }
            }
        );

        row.appendChild(itemText);
        row.appendChild(button);

        container.appendChild(row);
    });

    section.classList.remove('hidden');
}


/* -------------------------------------------------------
   RELEASE FOOD
------------------------------------------------------- */

async function releaseFood(foodItemId) {
    if (!currentInviteCode) {
        alert(text('genericError'));
        return false;
    }

    const { data, error } = await db.rpc(
        'release_food',
        {
            p_invite_code: currentInviteCode,
            p_food_item_id: foodItemId
        }
    );

    if (error) {
        console.error(
            'Release food error:',
            error
        );

        alert(text('genericError'));

        return false;
    }

    console.log('Food released:', data);

    return true;
}


/* -------------------------------------------------------
   START
------------------------------------------------------- */

document.addEventListener(
    'DOMContentLoaded',
    async () => {
        await loadInvitation();

        // RSVP and food are invitation-only. Only load food after the
        // invite code has been successfully validated by get_invitation().
        if (currentInvitation && currentInviteCode) {
            await loadMyFood();
            await loadFood();
        }

        const attendingButton =
            document.getElementById(
                'rsvp-attending'
            );

        const declinedButton =
            document.getElementById(
                'rsvp-declined'
            );

        const scrollButton =
            document.getElementById('scrollToRsvp');

        if (scrollButton) {
            scrollButton.addEventListener('click', () => {
                document.getElementById('rsvp')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            });
        }

        if (attendingButton) {
            attendingButton.addEventListener(
                'click',
                () => {
                    saveRsvp(true);
                }
            );
        }

        if (declinedButton) {
            declinedButton.addEventListener(
                'click',
                () => {
                    saveRsvp(false);
                }
            );
        }
    }
);
