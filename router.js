import { $$ } from './utils.js';

export function setActiveNav(hash){
  $$(".nav-link").forEach(a=>{
    const is = a.getAttribute("href") === hash.split("?")[0];
    a.classList.toggle("active", is);
  });
}

export function route(){
  const hash = location.hash || "#/dashboard";
  setActiveNav(hash);
  window.dispatchEvent(new CustomEvent("route:change", { detail:{ hash } }));
}
