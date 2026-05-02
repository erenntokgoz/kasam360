const mongoose = require('mongoose');
const uri = "mongodb://kasam360admin:kfjAfdKsgE9NHziD@ac-hrj6zfm-shard-00-00.atzy0lb.mongodb.net:27017,ac-hrj6zfm-shard-00-01.atzy0lb.mongodb.net:27017,ac-hrj6zfm-shard-00-02.atzy0lb.mongodb.net:27017/kasam360?ssl=true&replicaSet=atlas-hrj6zfm-shard-0&authSource=admin&retryWrites=true&w=majority";

mongoose.connect(uri).then(() => {
    console.log("Connected to MongoDB!");
    process.exit(0);
}).catch(err => {
    console.error(err);
    process.exit(1);
});
