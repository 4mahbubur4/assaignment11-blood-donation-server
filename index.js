const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

const serviceAccount = require("./blood-aid-firebase-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.send(401).send({ message: "unauthorized access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@blood-aid.crhl5qx.mongodb.net/?appName=Blood-aid`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const db = client.db("blood-aid_db");
    const bloodCollection = db.collection("bloods");
    const userCollection = db.collection("users");
    const volunteerCollection = db.collection("volunteer");

    // users related api
    app.get("/users", verifyFBToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
   
    app.get('/users/:email/role', async(req, res)=>{

      const email = req.params.email;
      const query = { email}
      const user = await userCollection.findOne(query);
      console.log(user)
      res.send({role: user?.role || 'user'})

    } )
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.role = "donar";
      user.createAt = new Date();
      user.status = "available";
      const result = await userCollection.insertOne(user);
      res.send(result);
    });
    app.patch("/users/status/:email", async (req, res) => {
      const email = req.params.email;
      const { status } = req.body;
      const result = await userCollection.updateOne(
        { email: email },
        { $set: { status: status } },
      );
      res.send(result);
    });
   
    app.patch("/users/update-role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const { role } = req.body; 

        const filter = { email: email };
        const updatedDoc = {
          $set: {
            role: role,
          },
        };

        const result = await userCollection.updateOne(filter, updatedDoc);

        if (result.modifiedCount > 0) {
          res.send(result);
        } else {
          res
            .status(404)
            .send({ message: "User not found or no changes made" });
        }
      } catch (error) {
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);

      if (result) {
        res.send(result);
      } else {
        res.status(404).send({ message: "User not found" });
      }
    });
    // bloods api
    app.get("/bloods", async (req, res) => {
      try {
        let query = {};

        if (req.query?.email) {
          query = { requesterEmail: req.query.email };
        }

        const cursor = bloodCollection.find(query);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Forbidden access" });
      }
    });

    app.post("/bloods", async (req, res) => {
      const blood = req.body;
      const result = await bloodCollection.insertOne(blood);
      res.send(result);
    });
    // bloods status update API
app.patch("/bloods/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };
    const updatedData = req.body; 
    const updatedDoc = {
      $set: {
        status: updatedData.status,
        
        handler: updatedData.handler 
      },
    };

    const result = await bloodCollection.updateOne(filter, updatedDoc);

    if (result.modifiedCount > 0) {
      res.send(result);
    } else {
      res.status(404).send({ message: "Request not found or no changes made" });
    }
  } catch (error) {
    console.error("Blood Patch Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

    app.delete("/bloods/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };

      const result = await bloodCollection.deleteOne(query);
      res.send(result);
    });
    // volunteer related api
    app.post("/volunteer", async (req, res) => {
      const volunteer = req.body;

      const query = { email: volunteer.email };
      const existingRequest = await volunteerCollection.findOne(query);

      if (existingRequest) {
        return res
          .status(400)
          .send({ message: "Request already exists", insertedId: null });
      }

      const newVolunteer = {
        ...volunteer,
        status: "pending",
        appliedAt: new Date(),
      };

      const result = await volunteerCollection.insertOne(newVolunteer);
      res.send(result);
    });
    app.get("/volunteer", async (req, res) => {
      const query = {};
      if (req.query.status) {
        query.status = req.query.status;
      }
      const cursor = volunteerCollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.patch("/volunteer/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const { status, email } = req.body;

        let query = { _id: new ObjectId(id) };
        let result = await volunteerCollection.updateOne(query, {
          $set: { status: status },
        });

        if (result.matchedCount === 0) {
          query = { _id: id };
          result = await volunteerCollection.updateOne(query, {
            $set: { status: status },
          });
        }

        if (result.matchedCount > 0) {
          let newRole = "";

          if (status === "approve") {
            newRole = "volunteer";
          } else if (status === "block") {
            newRole = "donar";
          }

          if (newRole) {
            await volunteerCollection.updateOne(
              { email: email },
              { $set: { role: newRole } },
            );
            console.log(`User ${email} role changed to: ${newRole}`);
          }
        }

        res.send(result);
      } catch (error) {
        console.error("Update Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Blood Donation server");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
