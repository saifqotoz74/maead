/* whatsapp: public support number, international format without +. Payment details are NOT on public pages.
   licenceApi: the licence server. Empty string turns the licence gate off.
   licencePubKey: public key that checks licence tokens (from /pubkey). Safe to publish.
   price: monthly price in EGP. null shows "السعر: يُحدد". */
window.MAEAD_CONFIG = {
  whatsapp: '201229105279',
  licenceApi: 'https://maead-licence.saifhossam661.workers.dev',
  licencePubKey: {"kty":"EC","crv":"P-256","x":"2LZTEcY6eQ3cidd2QZKGTRBItIH_Un9058jJywd7wj4","y":"VQPQ7pi27rLQZFADsf2a0YNACPTRqdCMiLMVqLZ-MRE","ext":true,"key_ops":["verify"]},
  price: 199
};
