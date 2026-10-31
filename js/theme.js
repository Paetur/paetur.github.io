(function(){
  'use strict';
  const preference=window.matchMedia('(prefers-color-scheme: dark)');
  function apply(){document.documentElement.dataset.theme=preference.matches?'dark':'light';document.documentElement.style.colorScheme=preference.matches?'dark':'light';}
  apply();preference.addEventListener('change',apply);
}());
