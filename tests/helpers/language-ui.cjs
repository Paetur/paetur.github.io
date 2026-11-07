async function selectContentTranslation(page,category){
 if(await page.locator('#settingsToggle').getAttribute('aria-pressed')==='true')await page.locator('#closeSettings').click();
 await page.locator('[data-tab="language"]').click();
 const group=['food','food-category','food-types'].includes(category)?'food':category;
 await page.locator('#contentTranslationTabs [data-translation-tab="'+group+'"]').click();
 if(group==='food')await page.locator('#foodTranslationTabs [data-translation-tab="'+category+'"]').click();
}
async function openWordingEditor(page,language,key){
 if(await page.locator('#settingsToggle').getAttribute('aria-pressed')!=='true')await page.locator('#settingsToggle').click();
 await page.locator('[data-settings-tab="languages"]').click();
 await page.locator('#interfaceLanguageTabs [data-translation-tab="'+language+'"]').click();
 const source=await page.evaluate(key=>Object.entries(window.RSVP_I18N.catalog).find(([,entry])=>entry.key===key)[0],key);
 await page.locator('#translationSearch').fill(source);
 const row=page.locator('[data-wording-key="'+key+'"]');
 await row.locator('.wording-summary button').click();
 return row;
}
module.exports={selectContentTranslation,openWordingEditor};
