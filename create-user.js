import { UserDB } from './backend/auth/auth-db.js';
import readline from 'readline';
import { fileURLToPath } from 'url';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise((resolve) => {
  rl.question(prompt, resolve);
});

async function createUser() {
  console.log('=== Create User ===\n');
  
  try {
    const username = await question('Username: ');
    const password = await question('Password: ');
    const email = await question('Email (optional): ');
    
    if (!username || !password) {
      console.error('\nError: Username and password are required!');
      process.exit(1);
    }
    
    // Check if user already exists
    const existingUser = await UserDB.findByUsername(username);
    if (existingUser) {
      console.error(`\nError: User '${username}' already exists!`);
      process.exit(1);
    }
    
    // Create the user
    const result = await UserDB.create(username, password, email || null);
    console.log(`\nUser '${username}' created successfully with ID: ${result.lastID}`);
    
    // List all users
    const users = await UserDB.getAll();
    console.log('\nAll users:');
    users.forEach(user => {
      console.log(`- ${user.username} (ID: ${user.id})`);
    });
    
  } catch (error) {
    console.error('\nError creating user:', error.message);
    process.exit(1);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Run the script
createUser();