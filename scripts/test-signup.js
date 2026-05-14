import axios from 'axios';

async function test() {
  try {
    const res = await axios.post('http://localhost:8080/auth/signup', {
      email: 'test_node_signup_' + Date.now() + '@example.com',
      password: 'StrongPassword123',
      fullName: 'Test User',
      phone: '9876543210',
      role: 'customer'
    });
    console.log("Success:", res.data);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}
test();
