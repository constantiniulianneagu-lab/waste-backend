import bcrypt from 'bcryptjs';

bcrypt.hash('admin123', 10).then(hash => {
  console.log('✅ Generated hash:');
  console.log(hash);
  console.log('\n📋 Copy this entire hash (60 characters):');
  console.log('Length:', hash.length);
});