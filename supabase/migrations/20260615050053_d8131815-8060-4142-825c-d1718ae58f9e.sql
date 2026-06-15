
CREATE POLICY "Anyone can view transfer photos" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'transfer-photos');

CREATE POLICY "Anyone can upload transfer photos" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'transfer-photos');
