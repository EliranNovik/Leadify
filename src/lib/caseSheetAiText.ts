/**
 * The case-sheet renderer, re-exported for the app.
 *
 * The implementation lives under `supabase/functions/_shared` because the edge functions can only
 * import from there, and the text it produces explains to the model how to read a handler's
 * shorthand — wording that has to be the same whether the case file was assembled in the browser or
 * on the edge. It is plain string work with no imports, so it runs in both.
 */
export * from '../../supabase/functions/_shared/caseSheetAiText';
