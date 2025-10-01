// Quick script to create a user with hardcoded credentials
// Change these values before running!
import { UserDB } from './backend/auth/auth-db.js';

const USERNAME = 'zuckzuckzuck';  // Change this
const PASSWORD = 'your-password-here';  // Change this
const EMAIL = null;  // Optional

async function quickCreateUser() {
  try {
    const existingUser = await UserDB.findByUsername(USERNAME);
    if (existingUser) {
      console.log(`User '${USERNAME}' already exists!`);
    } else {
      const result = await UserDB.create(USERNAME, PASSWORD, EMAIL);
      console.log(`User '${USERNAME}' created successfully with ID: ${result.lastID}`);
    }
    
    const users = await UserDB.getAll();
    console.log('\nAll users:');
    users.forEach(user => {
      console.log(`- ${user.username} (ID: ${user.id})`);
    });
  } catch (error) {
    console.error('Error:', error);
  }
  process.exit(0);
}

quickCreateUser();