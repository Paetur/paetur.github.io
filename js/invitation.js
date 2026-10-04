let currentInvitation = null;
let currentInviteCode = null;
let foodSelectionConfirmed = false;


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
    const rawQuery = window.location.search.replace(/^\?/, '').trim();

    // The public invitation format is exactly: ?ABCDEFGH
    // Named query parameters such as ?invite=ABCDEFGH are intentionally unsupported.
    currentInviteCode = /^[A-HJ-NP-Z2-9]{8}$/i.test(rawQuery)
        ? rawQuery.toUpperCase()
        : null;

    if (!currentInviteCode) {
        console.log('No valid invite code in URL');
        return;
    }

    const { data, error } = await db.rpc('get_invitation', {
        p_invite_code: currentInviteCode
    });

    if (error || !data) {
        if (error) console.error('Supabase error:', error);
        else console.log('Invitation not found');
        currentInviteCode = null;
        return;
    }

    currentInvitation = data;

    // Load household feature access and record the first/most recent open.
    const { data: access, error: accessError } = await db.rpc('get_invitation_access', {
        p_invite_code: currentInviteCode
    });
    if (accessError) console.error('Invitation access error:', accessError);
    currentInvitation.access = access || { food: false, stuff: false, things: false };

    const { error: visitError } = await db.rpc('mark_invitation_visited', {
        p_invite_code: currentInviteCode
    });
    if (visitError) console.error('Visit tracking error:', visitError);

    if (data.language && typeof setLanguage === 'function') setLanguage(data.language);
    renderInvitation(data);
}

function householdDisplayName(household) {
    const name = String(household?.household_name || '').trim();
    const lastName = String(household?.last_name || '').trim();

    if (!lastName) return name;
    if (name.toLocaleLowerCase('fo').endsWith(lastName.toLocaleLowerCase('fo'))) {
        return name;
    }

    return `${name} ${lastName}`.trim();
}

function invitationIsLocked(invitation = currentInvitation) {
    return Boolean(invitation?.guests?.some(guest => guest.rsvp_status !== 'pending'));
}

function guestDisplayName(guest) {
    const firstName = String(guest.first_name || '').trim();
    const placeholder = guest.is_child ? text('childFirstName') : text('firstName');
    return [guest.courtesy_title, firstName || placeholder, guest.last_name]
        .filter(Boolean)
        .join(' ');
}

function guestNameIsPlaceholder(guest) {
    return !String(guest.first_name || '').trim();
}

function titleOptions(selected = '') {
    return ['', 'Mr.', 'Ms.', 'Son', 'Daughter'].map(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value || text('courtesyTitle');
        option.selected = value === (selected || '');
        return option;
    });
}

function renderInvitation(invitation) {
    document.getElementById('rsvp')?.classList.remove('hidden');
    document.getElementById('scrollToRsvp')?.classList.remove('hidden');

    const locked = invitationIsLocked(invitation);
    const detailsButton = document.getElementById('scrollToDetails');
    if (detailsButton) detailsButton.classList.toggle('hidden', !locked);

    const displayName = householdDisplayName(invitation);
    const invitee = document.getElementById('invitee');
    if (invitee && displayName) {
        invitee.textContent = displayName;
        invitee.classList.remove('hidden');
    }

    const householdName = document.getElementById('household-name');
    if (householdName) householdName.textContent = displayName;

    const guestList = document.getElementById('guest-list');
    if (!guestList) return;
    guestList.innerHTML = '';

    invitation.guests.forEach(guest => {
        const row = document.createElement('div');
        row.className = 'invite-guest-row';

        if (locked) {
            const status = document.createElement('span');
            status.className = `invite-rsvp-status ${guest.rsvp_status === 'attending' ? 'yes' : 'no'}`;
            status.textContent = guest.rsvp_status === 'attending' ? '✓' : '✕';
            status.setAttribute('aria-label', guest.rsvp_status === 'attending' ? text('attending') : text('notAttending'));
            const name = document.createElement('span');
            name.textContent = guestDisplayName(guest);
            if (guestNameIsPlaceholder(guest)) name.classList.add('guest-name-placeholder');
            row.append(status, name);
        } else {
            const label = document.createElement('label');
            label.className = 'choice invite-guest-choice';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = guest.id;
            checkbox.dataset.guestId = guest.id;
            checkbox.checked = guest.rsvp_status === 'attending';
            const name = document.createElement('span');
            name.textContent = guestDisplayName(guest);
            if (guestNameIsPlaceholder(guest)) name.classList.add('guest-name-placeholder');
            label.append(checkbox, name);

            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'invite-name-edit';
            edit.textContent = text('edit');
            edit.addEventListener('click', () => showGuestEditor(row, guest));
            row.append(label, edit);
        }
        guestList.appendChild(row);
    });

    document.querySelector('.add-person-box')?.classList.toggle('hidden', locked);
    document.querySelectorAll('.rsvp-button').forEach(button => button.classList.toggle('hidden', locked));
}

function showGuestEditor(row, guest) {
    row.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'invite-guest-edit-form';

    const title = document.createElement('select');
    title.name = 'courtesy_title';
    title.setAttribute('aria-label', text('courtesyTitle'));
    titleOptions(guest.courtesy_title).forEach(option => title.appendChild(option));

    const first = document.createElement('input');
    first.name = 'first_name'; first.required = true; first.value = guest.first_name || ''; first.placeholder = guest.is_child ? text('childFirstName') : text('firstName');
    const last = document.createElement('input');
    last.name = 'last_name'; last.value = guest.last_name || ''; last.placeholder = text('lastName');
    const childLabel = document.createElement('label');
    childLabel.className = 'add-person-child';
    const child = document.createElement('input'); child.type = 'checkbox'; child.name = 'is_child'; child.checked = Boolean(guest.is_child);
    const childText = document.createElement('span'); childText.textContent = text('child');
    childLabel.append(child, childText);

    const save = document.createElement('button'); save.type = 'submit'; save.className = 'invite-name-edit invite-save-link'; save.textContent = text('save');
    form.append(title, first, last, childLabel, save);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        const { error } = await db.rpc('update_invited_guest', {
            p_invite_code: currentInviteCode,
            p_guest_id: guest.id,
            p_courtesy_title: title.value || null,
            p_first_name: first.value.trim(),
            p_last_name: last.value.trim() || null,
            p_is_child: child.checked
        });
        save.disabled = false;
        if (error) { console.error('Guest edit error:', error); alert(text('genericError')); return; }
        await loadInvitation();
    });
    row.appendChild(form);
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
   FOOD CONFIRMATION
------------------------------------------------------- */

function foodConfirmationKey() {
    return currentInviteCode ? `wedding-food-confirmed:${currentInviteCode}` : null;
}

function loadFoodConfirmation() {
    const key = foodConfirmationKey();
    foodSelectionConfirmed = Boolean(key && window.localStorage.getItem(key) === '1');
    applyFoodConfirmationState();
}

function applyFoodConfirmationState() {
    const available = document.getElementById('availableFoodSection');
    const confirmButton = document.getElementById('confirmFood');
    if (available) available.classList.toggle('hidden', foodSelectionConfirmed);
    if (confirmButton && foodSelectionConfirmed) confirmButton.classList.add('hidden');
}

function confirmFoodSelection() {
    const key = foodConfirmationKey();
    if (!key) return;
    window.localStorage.setItem(key, '1');
    foodSelectionConfirmed = true;
    applyFoodConfirmationState();
    const message = document.getElementById('foodConfirmMessage');
    if (message) {
        message.textContent = text('foodConfirmed');
        message.classList.remove('hidden');
    }
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
    if (!currentInvitation || !currentInviteCode || !currentInvitation.access?.food) {
        document.getElementById('foodSection')?.classList.add('hidden');
        return;
    }

    applyFoodConfirmationState();
    if (foodSelectionConfirmed) {
        document.getElementById('foodSection')?.classList.remove('hidden');
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
    // Claimed food is invitation-only too. Do not call the RPC until the
    // invitation itself has been successfully validated.
    if (!currentInvitation || !currentInviteCode) {
        document.getElementById('myFoodSection')?.classList.add('hidden');
        return;
    }

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

        row.appendChild(itemText);

        container.appendChild(row);
    });

    section.classList.remove('hidden');
    const confirmButton = document.getElementById('confirmFood');
    if (confirmButton) confirmButton.classList.toggle('hidden', foodSelectionConfirmed);
    applyFoodConfirmationState();
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
   EXTRA GUEST + HOUSEHOLD LISTS
------------------------------------------------------- */

async function addExtraGuest(event) {
    event.preventDefault();
    if (!currentInvitation || !currentInviteCode) return;
    const form = event.currentTarget;
    const firstName = form.querySelector('[name="first_name"]').value.trim();
    const lastName = form.querySelector('[name="last_name"]').value.trim();
    const courtesyTitle = form.querySelector('[name="courtesy_title"]')?.value || null;
    const message = document.getElementById('add-person-message');
    if (!firstName) return;
    const button = form.querySelector('button');
    button.disabled = true;
    const { error } = await db.rpc('add_invited_guest_with_title', {
        p_invite_code: currentInviteCode,
        p_courtesy_title: courtesyTitle,
        p_first_name: firstName,
        p_last_name: lastName || null,
        p_is_child: form.querySelector('[name="is_child"]')?.checked || false
    });
    button.disabled = false;
    if (error) {
        console.error('Add guest error:', error);
        alert(text('genericError'));
        return;
    }
    form.reset();
    if (message) { message.textContent = text('personAdded'); message.classList.remove('hidden'); }
    await loadInvitation();
}

async function loadGuestList(kind) {
    if (!currentInvitation || !currentInviteCode) return;
    const config = kind === 'stuff'
        ? { rpc: 'get_invited_stuff', section: 'stuffSection', list: 'guestStuffList' }
        : { rpc: 'get_invited_things', section: 'thingsSection', list: 'guestThingsList' };
    const { data, error } = await db.rpc(config.rpc, { p_invite_code: currentInviteCode });
    if (error) { console.error(`${kind} list error:`, error); return; }
    const section = document.getElementById(config.section);
    const list = document.getElementById(config.list);
    if (!section || !list) return;
    list.innerHTML = '';
    (data || []).forEach(item => {
        const row = document.createElement('div');
        row.className = 'guest-private-list-row';
        if (kind === 'stuff') row.textContent = `${item.item}${item.quantity ? ` × ${item.quantity}` : ''}`;
        else row.textContent = item.task;
        list.appendChild(row);
    });
    section.classList.remove('hidden');
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
            if (currentInvitation.access?.food) {
                loadFoodConfirmation();
                await loadMyFood();
                await loadFood();
            }
            if (currentInvitation.access?.stuff) await loadGuestList('stuff');
            if (currentInvitation.access?.things) await loadGuestList('things');
        }

        document.getElementById('add-person-form')?.addEventListener('submit', addExtraGuest);
        document.getElementById('confirmFood')?.addEventListener('click', confirmFoodSelection);

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
        const detailsButton = document.getElementById('scrollToDetails');

        if (detailsButton) {
            detailsButton.addEventListener('click', () => {
                const target = ['foodSection', 'stuffSection', 'thingsSection']
                    .map(id => document.getElementById(id))
                    .find(section => section && !section.classList.contains('hidden'));
                target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }

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