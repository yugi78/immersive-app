/** Protège /<projet>/admin/ : même règle que /admin/ (session requise). */
export { onRequest } from '../../admin/_middleware';
