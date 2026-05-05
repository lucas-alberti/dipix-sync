import { createClient } from '@supabase/supabase-js'
const SUPABASE_URL = "https://wlaaflgidjxmgvoaoyvd.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsYWFmbGdpZGp4bWd2b2FveXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzU0MTIsImV4cCI6MjA4ODY1MTQxMn0.IJLIAufX6v9uEi6Aa5qYAx6lecHyvyRRQ9eE23Q3Jlg"
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
