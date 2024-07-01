const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const pool = require("./database"); 
const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: "secret",
    resave: false,
    saveUninitialized: true,
  })
);
app.set("view engine", "ejs");
app.set("views", __dirname + "/views"); 


function isAuthenticated(req, res, next) {
  if (req.session.user) {
    next();
  } else {
    res.redirect("/login");
  }
}
app.use((req, res, next) => {
  req.user = {
    id: 1, 
    name: 'John Doe'
  };
  next();
});
app.get("/", (req, res) => {
  res.redirect("/dashboard");
});


app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.user = user;
        return res.redirect(user.role === "admin" ? "/admin-dashboard" : "/player-dashboard");
      }
    }
    res.redirect("/login");
  } catch (error) {
    console.error("Error during login:", error);
    res.redirect("/login");
  }
});

app.get("/dashboard", (req, res) => {
  res.render("dashboard", { user: req.session.user });
});

app.get("/register", (req, res) => {
  res.render("register");
});

app.post("/register", async (req, res) => {
  const { name, email, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
      [name, email, hashedPassword, role]
    );
    res.redirect("/login");
  } catch (error) {
    console.error("Error during registration:", error);
    res.redirect("/register");
  }
});

app.get("/admin-dashboard", isAuthenticated, async (req, res) => {
  try {
    const sports = await pool.query("SELECT * FROM sports");
    const sessions = await pool.query(
      "SELECT sessions.*, sports.name AS sport_name, users.name AS creator_name " +
      "FROM sessions " +
      "JOIN sports ON sessions.sport_id = sports.id " +
      "JOIN users ON sessions.creator_id = users.id"
    );
    res.render("admin-dashboard", {
      user: req.session.user,
      sports: sports.rows,
      sessions: sessions.rows,
    });
  } catch (error) {
    console.error("Error loading admin dashboard:", error);
    res.redirect("/admin-dashboard");
  }
});

app.post("/create-sport", isAuthenticated, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query("INSERT INTO sports (name) VALUES ($1)", [name]);
    res.redirect("/admin-dashboard");
  } catch (error) {
    console.error("Error creating sport:", error);
    res.redirect("/admin-dashboard");
  }
});

app.post("/delete-sport/:id", isAuthenticated, async (req, res) => {
  const sportId = req.params.id;
  try {
    await pool.query("DELETE FROM sports WHERE id = $1", [sportId]);
    res.sendStatus(200); 
  } catch (error) {
    console.error("Error deleting sport:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.post("/delete-session/:session_id", isAuthenticated, async (req, res) => {
  const sessionId = req.params.session_id;
  try {
    await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
    res.redirect("/admin-dashboard");
  } catch (error) {
    console.error("Error deleting session:", error);
    res.redirect("/admin-dashboard");
  }
});

app.post("/edit-session", isAuthenticated, async (req, res) => {
  try {
    const { session_id, team1, team2, date, venue } = req.body;

    
    if (!session_id || !team1 || !team2 || !date || !venue) {
      return res.status(400).send("All fields are required.");
    }

  
    await pool.query(
      "UPDATE sessions SET team1 = $1, team2 = $2, date = $3, venue = $4 WHERE id = $5",
      [team1, team2, date, venue, session_id]
    );

    res.redirect("/admin-dashboard");
  } catch (error) {
    console.error("Error updating session:", error);
    res.status(500).send("Failed to update session. Please try again later.");
  }
});

app.get("/player-dashboard", isAuthenticated, async (req, res) => {
  try {
    const sessions = await pool.query(
      "SELECT sessions.*, sports.name AS sport_name " +
      "FROM sessions " +
      "JOIN sports ON sessions.sport_id = sports.id"
    );
    const sports = await pool.query("SELECT * FROM sports");
    res.render("player-dashboard", {
      user: req.session.user,
      sessions: sessions.rows,
      sports: sports.rows,
    });
  } catch (error) {
    console.error("Error loading player dashboard:", error);
    res.redirect("/player-dashboard");
  }
});

app.post("/create-session", isAuthenticated, async (req, res) => {
  const { sport_id, team1, team2, date, venue } = req.body;
  try {
    await pool.query(
      "INSERT INTO sessions (sport_id, creator_id, team1, team2, date, venue) VALUES ($1, $2, $3, $4, $5, $6)",
      [sport_id, req.session.user.id, team1, team2, date, venue]
    );
    res.redirect("/admin-dashboard");
  } catch (error) {
    console.error("Error creating session:", error);
    res.redirect("/admin-dashboard");
  }
});


app.post('/join-session', async (req, res) => {
  const { session_id } = req.body;
  const player_id = req.user.id;

  console.log('Received session_id:', session_id, 'and player_id:', player_id);

  if (!session_id) {
    return res.status(400).json({ error: 'session_id is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO session_players (session_id, player_id) VALUES ($1, $2) RETURNING *',
      [session_id, player_id]
    );

    const sessionResult = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [session_id]
    );
    const session = sessionResult.rows[0];

    const playersResult = await pool.query(
      'SELECT users.name FROM session_players JOIN users ON session_players.player_id = users.id WHERE session_players.session_id = $1',
      [session_id]
    );
    session.players = playersResult.rows.map(row => row.name);

    res.json({ session });
  } catch (error) {
    console.error('Error joining session:', {
      message: error.message,
      stack: error.stack,
      details: error
    });
    res.status(500).json({ error: 'Failed to join session' });
  }
});
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

app.get("/reports", isAuthenticated, async (req, res) => {
  try {
    const sessions = await pool.query(
      "SELECT sessions.*, sports.name AS sport_name " +
      "FROM sessions " +
      "JOIN sports ON sessions.sport_id = sports.id"
    );
    const popularity = await pool.query(
      "SELECT sports.name, COUNT(sessions.id) AS count " +
      "FROM sessions " +
      "JOIN sports ON sessions.sport_id = sports.id " +
      "GROUP BY sports.name"
    );
    res.render("reports", {
      sessions: sessions.rows,
      popularity: popularity.rows,
    });
  } catch (error) {
    console.error("Error loading reports:", error);
    res.redirect("/admin-dashboard");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
