const app = require('./app');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Roach Reports API running on http://localhost:${PORT}`);
});
