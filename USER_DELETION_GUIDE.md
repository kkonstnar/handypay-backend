# User Deletion Examples

## Delete a user by ID (replace USER_ID with actual user ID)

### Using curl:
curl -X DELETE https://handypay-backend.onrender.com/api/users/USER_ID

### Using JavaScript/fetch:
fetch('https://handypay-backend.onrender.com/api/users/USER_ID', {
  method: 'DELETE'
})
.then(response => response.json())
.then(data => console.log(data));

### Expected Response:
{
  "success": true,
  "message": "User USER_ID and all related data deleted successfully"
}

## Find user IDs first:
curl https://handypay-backend.onrender.com/api/users/YOUR_USER_ID/transactions

