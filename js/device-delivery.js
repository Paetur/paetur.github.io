(function(){
 'use strict';
 // Construct only explicit single-recipient handoffs. Opening a composer never records sending.
 function compose(q){
  const raw=String(q.recipient_snapshot?.contact_value||'').trim();
  if(q.channel==='email'){
   if(!/^[^\s@<>?,;:]+@[^\s@<>?,;:]+\.[^\s@<>?,;:]+$/.test(raw))throw Error('Enter one valid email address.');
   return 'mailto:'+encodeURIComponent(raw)+'?subject='+encodeURIComponent(q.message_subject||'')+'&body='+encodeURIComponent(q.message_body||'');
  }
  if(!['sms','whatsapp'].includes(q.channel))return null;
  if(!/^(\+|00)[1-9][0-9 ()-]*$/.test(raw))throw Error('Use an international phone number, including country code.');
  const digits=raw.replace(/^00/,'+').replace(/[^0-9]/g,'');
  if(digits.length<7||digits.length>15)throw Error('Use an international phone number, including country code.');
  return q.channel==='sms'?'sms:+'+digits:'https://wa.me/'+digits+'?text='+encodeURIComponent(q.message_body||'');
 }
 window.RSVP_DEVICE_DELIVERY=Object.freeze({compose});
})();
