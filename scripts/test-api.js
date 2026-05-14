import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://www.rfincare.com';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJjY215ZWNlYWFsc2Jiemp3dGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0NTQxMTksImV4cCI6MjA4NDAzMDExOX0.Hvqp3lLwYHfVDWyHp_IbG1mnIUCXKLtZ2v1_qcxRB5o';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log("Testing Supabase...");
  const res = await supabase.from('banks').select('id').limit(1);
  console.log("Supabase result:", res);
}

test();
