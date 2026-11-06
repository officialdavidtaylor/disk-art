import {defineConfig} from 'cf/config';
export default defineConfig({
 accountId:'0a182a9ec3a53bda1cb671852fa7e1c1',
 worker:{
  name:'dvd-art',
  compatibilityDate:'2026-11-06',
  assets:{notFoundHandling:'single-page-application'},
  domains:['dvd-art.emfsoft.com'],
 },
});
