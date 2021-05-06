
/**
 * Filename: server.js
 * Description: Syscoin-based Discord Tip Bot
 * Coded by: jg
 * Edited: 04/17/2021
 *
 * Before running this bot for the first time please ensure that you create a new
 * 12 word Syscoin mnemonic in config.json and create a safe, secure backup of it somewhere,
 * delete the receiveIndex/auctionIndex/tradeIndex files in the ls folder (if there) and have a new MongoDB database
 * running in the background (once MongoDB is installed it can normally be done with 'sudo service mongod start').
 * The config.json file must also be configured to the Discord server you are running.
 **/

// variables
const c = require('./c.json')
const config = require('./config.json')
var prefix = config.prefix
const MESSAGE_CHAR_LIMIT = 1980;

// requires
const fs = require('fs')
const ccxt = require ('ccxt')
const express = require('express')
const request = require('request')
const mongoose = require('mongoose')
const base64 = require('base-64')
const axios = require('axios')

const BigNumber = require('bignumber.js')
BigNumber.config({ DECIMAL_PLACES: 8 })
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

const app = express()
app.use(express.static('public'))
app.get('/', function(request, response) {
  response.send("Running botserver")
})

const listener = app.listen(process.env.PORT, function() {
  console.log('Listening on port ' + listener.address().port)
})

if (typeof localStorage === "undefined" || localStorage === null) {
  var LocalStorage = require('node-localstorage').LocalStorage
  localStorage = new LocalStorage('./ls')
  var ls = require("./ls")
}

// Discord.js initialized
const Discord = require('discord.js')
const client = new Discord.Client()

const db = require('./db.js')
db.connect()

const sjs = require('syscoinjs-lib')
// blockbook URL
const backendURL = config.blockURL
// 'null' for no password encryption for local storage and 'true' for testnet
const HDSigner = new sjs.utils.HDSigner(config.mnemonic, null, config.testnet)
var receiveIndex = ls.get("receiveIndex")
if (receiveIndex) {
  HDSigner.receivingIndex = Number(receiveIndex)
} else {
  ls.set("receiveIndex", HDSigner.receivingIndex)
}
const syscoinjs = new sjs.SyscoinJSLib(HDSigner, backendURL)
const BN = sjs.utils.BN

const auctions = require('./auctions.js')
const endWatcher = require('./endWatcher.js')(client)
const giveaways = require('./giveaway.js')
const missions = require('./missions.js')
const tips = require('./tips.js')
const trades = require('./trades.js')
const utils = require('./utils.js')
const withdraws = require('./withdraws.js')

// Constants required
const constants = require("./constants")

// constant functions - split string
const splitString = (string, prepend = '', append = '') => {
  if (string.length <= MESSAGE_CHAR_LIMIT) {
    return [string];
  }
  const splitIndex = string.lastIndexOf('\n', MESSAGE_CHAR_LIMIT - prepend.length - append.length);
  const sliceEnd = splitIndex > 0 ? splitIndex : MESSAGE_CHAR_LIMIT - prepend.length - append.length;
  const rest = splitString(string.slice(sliceEnd), prepend, append);

  return [`${string.slice(0, sliceEnd)}${append}`, `${prepend}${rest[0]}`, ...rest.slice(1)];
};

// check if a profile with the given userid exists
async function ifProfile(userId) {
  try {
    let profile = await db.getProfile(userId)
    if (profile) {
      return profile
    } else {
      return false
    }
  } catch (error) {
    console.log(error)
    return false
  }
}

process.on('SIGINT', function() {
    console.log("Caught interrupt signal")
    process.exit()
})

client.on('ready', () => {
    console.log('Up and running!')
    // set status
    client.user.setActivity(`#tips - !help `, { type: 'WATCHING' })
})


const checkHouseProfile = async () => {
  // create house profile
  let profileExists = await ifProfile("houseprofile")
  if (!profileExists) {
    const createHouseProfile = async () => {
      let accountIndex = HDSigner.createAccount() - 1
      HDSigner.setAccountIndex(accountIndex)
      let newAddress = await HDSigner.getNewReceivingAddress()
      ls.set("receiveIndex", HDSigner.receivingIndex)
      console.log(ls.get("receiveIndex"))
      let profile = await db.createProfile("houseprofile", newAddress)
      let sysBalance = await db.createBalance("houseprofile", "SYS", 0)
    }
    createHouseProfile()
  }
}

checkHouseProfile()

client.on('message', async message => {
  try {
     if (message.author.bot) { return }  // no bots

     // if a user posts in the mission channel with an active mission name
     // add them to the mission
     if (message.channel.id == config.missionChannel) {
       try {
         var missionName = message.content.split(" ", 1)
         missionName[0] = missionName[0].toUpperCase()
         var mission = await db.getMission(missionName[0])
         if (mission) {
           if (mission.active) {
             let missionUpdated = await db.addProfileToMission(message.author.id, missionName[0])
           }
         } else {
           console.log(`Mission ${missionName} not found`)
         }
       } catch (error) {
         console.log(error)
         message.channel.send({embed: { color: c.FAIL_COL, description: "Error adding to mission."}})
       }
     }

for(var i = 0; i < message.embeds.length; i++) { console.log(`LOG: ${message.createdTimestamp} #${message.channel.name} ${message.author.id} <@${message.author.id}>: ${message.embeds[i].description}`) }

var splitter = message.content.replace(" ", ":splitter185151813367::")
var fixspaces = splitter.replace(":splitter185151813367:::splitter185151813367::", ":splitter185151813367::")
var splitted = fixspaces.split(":splitter185151813367::")

//  var splitted = splitter.split(":splitter185151813367::")
var prefix = config.prefix
var fixRegExp = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
var re = new RegExp(fixRegExp)
var command = splitted[0].replace(re, "")
if (splitted[1]) {
  var args = splitted[1].split(" ")
}
else {
 var args = false
}

// fix double space
if (args[0] == ("")) { args.shift() }

if (message.author.bot) {
   return false
}
var works = false

if ((!splitted[0] || !splitted[0].match(prefix)) && !works) {
  return false
  //No prefix detected
}

//Check for command:
switch (command) {
  case "help":

    switch(message.channel.id) {
      case config.tradeChannel:
        message.channel.send({embed: { color: c.SUCCESS_COL, description: constants.help("trade")}})
        break

      case config.auctionChannel:
        message.channel.send({embed: { color: c.SUCCESS_COL, description: constants.help("auction")}})
        break

      case config.missionChannel:
        message.channel.send({embed: { color: c.SUCCESS_COL, description: constants.help("mission")}})
        break

      case config.tipChannel:
        message.channel.send({embed: { color: c.SUCCESS_COL, description: constants.help("main")}})
        break

      default:
        break
    }
    break

  case "adminhelp":
    if (message.member.roles.cache.has(config.adminRoleID)) {
      message.channel.send({embed: { color: c.SUCCESS_COL, description: constants.help("admin")}})
    }
    break

  case "dep":
  case "deposit":
    try {
      var myProfile = await db.getProfile(message.author.id)
      if (myProfile) {
        message.author.send({embed: { color: c.SUCCESS_COL, description: "Hi, **<@" + message.author.id + ">** Any coins/tokens sent to this address will be added to your " + config.botname + ` balance within a few minutes.\n\n` +
                                                    `:warning: IMPORTANT: Make sure that all transactions sent to this deposit address have been confirmed at least once before using the !balance command, otherwise your funds might be lost. :warning:\n\nYour personal deposit address:\n\n${myProfile.address}`}})
      }
    } catch (error) {
      console.log(error)
    }
    break

  case "block":
  case "blocks":
  case "blockchain":
    const getBlockCount = async () => {
      try {
        const resp = await axios.get(`${backendURL}/api`)
        var bb = resp.data.blockbook
        var backend = resp.data.backend
        var blockSize = new BigNumber(backend.sizeOnDisk)
        var blockSizeGB = utils.toWholeUnit(blockSize, 9).toFixed(3)

        message.channel.send({embed: {
          color: c.SUCCESS_COL,
          description: `Block Height: ${backend.blocks}` +
                        `\nSubversion: ${backend.subversion}` +
                        `\nDifficulty: ${backend.difficulty}`+
                        `\nMempool Size: ${bb.mempoolSize}` +
                        `\nSize on Disk: ~${blockSizeGB} GB`
        }})
      } catch (error) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Unable to get the blockchain data. Please try again later."}})
        console.error(error)
      }
    }
    getBlockCount()
    break

  case "withdraw":
  case "withdrawal":
    // withdraws the specified amount of SYS and SPTs from a user's tipbot account

    if (message.channel.id == config.tipChannel) {
      withdraws.withdraw(args, message, client, HDSigner, syscoinjs)
    }
    break

  case "bal":
  case "balance":
    // used to check a user's balance and to deposit tokens if they have any in their deposit address
    // will then change the deposit address to a new receive address

    try {
      if (message.channel.id == config.tipChannel
          || message.channel.id == config.tradeChannel
          || message.channel.id == config.auctionChannel
          || message.channel.id == config.missionChannel
          || message.channel.id == config.giveawayChannel) {

        // get the relevant profile's info
        const userProfile = await db.getProfile(message.author.id)

        if (userProfile != undefined) {

         client.users.fetch(message.author.id).then((user) => {
             const makeBalTransferPrivate = async () => {

               var actionStr = ""
               let options = {details: "tokenBalances"}
               const backendAccount = await sjs.utils.fetchBackendAccount(backendURL, userProfile.address, options)
               const depBalance = new BigNumber(backendAccount.balance)
               var balWasUpdated = false
               // check and add any sys within the deposit address to the profile's balance
               if (depBalance.gt(0)) {
                 var sysBalance = await db.getBalance(message.author.id, "SYS")
                 var sysBalance = new BigNumber(sysBalance.amount)

                 actionStr += `[SYS | deposit: ${depBalance.toString()} | `
                 actionStr += `new balance: ${sysBalance.toString()}]`

                 var updatedAmount = sysBalance.plus(depBalance)
                 var profileUpdated = await db.editBalanceAmount(message.author.id, "SYS", updatedAmount)
                 if (profileUpdated) {
                   balWasUpdated = true
                 }
               }
               // check and add any tokens within the deposit address to the profile's balances
               var tokens = backendAccount.tokens
               if (tokens != undefined) {
                 if (tokens.length > 0) {
                   for (var i = 0; i < tokens.length; i++) {
                     if (Number(tokens[i].balance) > 0) {
                       var userTokenBal = await db.getBalance(message.author.id, tokens[i].assetGuid)
                       if (!userTokenBal) {
                         var userNewTokenBal = await db.createBalance(message.author.id, tokens[i].assetGuid, tokens[i].balance)
                         if (userNewTokenBal) {
                           balWasUpdated = true
                         }
                       } else {
                         var oldTokenBal = new BigNumber(userTokenBal.amount)
                         var tokenDeposit = new BigNumber(tokens[i].balance)
                         var newAmount = oldTokenBal.plus(tokenDeposit)

                         actionStr += ` [${base64.decode(tokens[i].symbol).toUpperCase()} (${tokens[i].assetGuid}) deposit: ${tokens[i].balance} | `
                         actionStr += `new balance: ${newAmount.toString()}]`

                         var userUpdatedTokenBal = await db.editBalanceAmount(message.author.id, tokens[i].assetGuid, newAmount)
                         if (userUpdatedTokenBal) {
                           balWasUpdated = true
                         }
                       }
                     }
                   }
                 }
               }
               var newAddress
               if (balWasUpdated) {
                 var rIndex = ls.get("receiveIndex")
                 actionStr += ` || Receive Index: ${rIndex} || Address: ${userProfile.address}`

                 newAddress = await HDSigner.getNewReceivingAddress()
                 ls.set("receiveIndex", HDSigner.receivingIndex)
                 var profileNewAdd = await db.editProfileAddress(message.author.id, newAddress)
                 if (!profileNewAdd) {
                   console.log("Error changing profile's address: " + message.author.id)
                 }
               }

               let log = await db.createLog(message.author.id, actionStr, [], 0)

               let profileBals = await db.getBalances(message.author.id)
               // create the balance string showing all sys and token balances
               // stored in profile
               var token
               let balString = ""
               for (let i = 0; i < profileBals.length; i++) {
                 let cc = profileBals[i]
                 for (let key in cc) {
                   if (key === "currencyID") {
                     if (cc[key] !== "SYS") {
                       token = await utils.getSPT(cc[key])

                       if (!token) {
                         return
                       }

                       let symbol = base64.decode(token.symbol).toUpperCase()
                       let tokenStr = `${symbol} (${token.assetGuid})`
                       let currencyStr = await utils.getExpLink(token.assetGuid, c.TOKEN, tokenStr)

                       balString += currencyStr
                     } else {
                       balString += (cc[key]).toUpperCase()
                     }
                     balString += ": "
                   } else {
                     if (key === "amount") {
                       if (token != undefined) {
                         balString += utils.toWholeUnit(new BigNumber(cc[key]), token.decimals).toString()
                       } else {
                         balString += utils.toWholeUnit(new BigNumber(cc[key]), 8).toString()
                       }
                     }
                   }
                 }
                 if (i + 1 != profileBals.length) {
                   balString += "\n"
                 }
                 token = undefined
               }

               user.send({embed: { color: c.SUCCESS_COL, description: `<\@${message.author.id}> has:\n ${balString.toLocaleString()}`}})
               if (balWasUpdated) {
                 user.send({embed: { color: c.SUCCESS_COL, description: `A new deposit address has been created for you, do not send any more funds to the previous deposit address:\n\n${newAddress}`}})
               }
             }
         makeBalTransferPrivate()
         })
         message.channel.send({embed: { color: c.SUCCESS_COL, description: `:rolling_eyes::point_up: <@${message.author.id}>, I've sent your balance in a private message.`}}).then(msg => {msg.delete({timeout: 3000}); message.delete({timeout: 3000})})
        } else {
          message.channel.send({embed: { color: 16776960, description: `Use ${prefix}register to create a ${config.botname} profile!` }}) }
          return false;
        }
    } catch (error) {
      console.log(error)
    }
    break

   case "verifytoken":
    // verify a token so that users can refer to a token with its symbol instead of guid

    try {
      if (!utils.checkAdminRole(message)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Sorry, you do not have the required permission."}});
        return
      }

      if (args[0] != undefined) {
        let asset = await sjs.utils.fetchBackendAsset(backendURL, args[0])
        if (asset.assetGuid == undefined) {
          message.channel.send({embed: { color: c.FAIL_COL, description: "Cannot find a SPT with the given GUID. Please ensure it's correct."}})
          return
        }
        let symbol = base64.decode(asset.symbol).toUpperCase()
        let sptExists = await db.getSPT(symbol)

        if (sptExists) {
          message.channel.send({embed: { color: c.FAIL_COL, description: "Token symbol already in use."}});
          return
        }

        let spt = await db.createSPT(symbol, args[0])
        if (spt) {
          message.channel.send({embed: { color: c.SUCCESS_COL, description: `Symbol ${symbol} has now been linked to GUID ${args[0]}`}});
        } else {
          message.channel.send({embed: { color: c.FAIL_COL, description: "Error verifying token."}});
        }
      } else {
        message.channel.send({embed: { color: c.FAIL_COL, description: `Usage: ${prefix}verifytoken [guid]`}})
      }
    } catch (error) {
      console.log(error)
    }
   break

  case "createmission":
     // create mission
     if (message.channel.id == config.missionChannel) {
       missions.createMission(args, message, client)
     }
     break

  case "missions":
    // list all active missions
    if (message.channel.id == config.missionChannel) {
      missions.listMissions(args, message, client)
    }
    break

  case "missionarchive":
    // list all archived missions
    if (message.channel.id == config.missionChannel) {
      missions.missionArchive(args, message, client)
    }
    break

  case "remove":
     // remove a profile from the given mission
     if (message.channel.id == config.missionChannel) {
       missions.removeFromMission(args, message, client)
     }
     break

  case "add":
    // add a profile to a given mission
    if (message.channel.id == config.missionChannel) {
      missions.addToMission(args, message, client)
    }
    break

  case "list":
    // show all profiles added to a mission
    if (message.channel.id == config.missionChannel) {
      missions.listMissionProfiles(args, message, client)
    }
    break

  case "paymission":
    // pay mission
    if (message.channel.id == config.missionChannel) {
      missions.payMission(args, message, client)
    }
    break

  case "archive":
     // archive mission
     if (message.channel.id == config.missionChannel) {
       missions.archiveMission(args, message, client)
     }
     break

  case "restrict":
    // restrict a user from using the tipbot functions

    try {
      if (!utils.checkAdminRole(message)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Sorry, you do not have the required permission."}});
        return
      }

      var mod = await db.getProfile(message.author.id)
      if (args[0] && mod) {
        let now = new Date()
        let nameID = args[0].replace(/<@!|>/gi,"")

        client.users.fetch(nameID).then(async (user) => {
          var userProfile = await db.getProfile(user.id)
          if (userProfile) {
            userProfile.restricted = true
            let profile = await db.editProfile(user.id, userProfile.address, userProfile.restricted)
            if (profile.restricted) {
              message.channel.send({embed: { color: c.SUCCESS_COL, description: `:warning: Okay, <@${nameID}> has been restricted from collecting rain until further notice. Please contact a member of the Syscoin team!`}})
              user.send({embed: { color: c.FAIL_COL, description: `:warning: Your tipbot account has been restricted! Please contact a member of the Syscoin team!` }})
              var actionStr = `Restrict: by mod ${message.author.id}`
              let log = await db.createLog(message.author.id, actionStr, [user.id])
            }
          } else {
            message.author.send({embed: { color: c.FAIL_COL, description: `:warning: The user you are attempting to restrict is not a registered user.` }})
          }
        });

      }
    } catch (error) {
      console.log(error)
    }
    break

  case "check":
    // check if a user has been restricted or not

    try {
      if (!utils.checkAdminRole(message)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Sorry, you do not have the required permission."}});
        return
      }

      let nameID = args[0].replace(/<@!|>/gi,"")
      let checkProfile = await db.getProfile(nameID)

      if (checkProfile != undefined) {
        var restricted = checkProfile.restricted
        if (restricted) {
          message.channel.send({embed: { color: c.FAIL_COL, description: `<@${nameID}> is on the restricted list.`}})
        } else {
          message.channel.send({embed: { color: c.SUCCESS_COL, description: `<@${nameID}> is registered and not restricted.`}})
        }
      } else {
        message.channel.send({embed: { color: c.FAIL_COL, description: `<@${nameID}> has not registered with me!  User must type **${prefix}register**`}})
      }
    } catch (error) {
      console.log(error)
    }
    break

  case "unrestrict":
    // unrestrict a user from using the tipbot functions

    try {
      if (!utils.checkAdminRole(message)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Sorry, you do not have the required permission."}});
        return
      }

      var mod = await db.getProfile(message.author.id)
      if (args[0] && mod) {
        let now = new Date()
        let nameID = args[0].replace(/<@!|>/gi,"")

        client.users.fetch(nameID).then(async (user) => {
          var userProfile = await db.getProfile(user.id)
          if (userProfile) {
            userProfile.restricted = false
            let profile = await db.editProfile(user.id, userProfile.address, userProfile.restricted)
            if (!profile.restricted) {
              message.channel.send({embed: { color: c.SUCCESS_COL, description: `Okay, <@${nameID}> has been allowed to collect rain.`}})
              user.send({embed: { color: c.SUCCESS_COL, description: `:fireworks: Your tipbot account is no longer restricted!  Please follow the Syscoin rules!` }})
              var actionStr = `Unrestrict: by mod ${message.author.id}`
              let log = await db.createLog(message.author.id, actionStr, [user.id])
            }
          } else {
            message.author.send({embed: { color: c.FAIL_COL, description: `:warning: The user you are attempting to unrestrict is not a valid user.` }})
          }
        });
      }
    } catch (error) {
      console.log(error)
    }
    break

  case "ping":
    const m = await message.channel.send("Ping...");
    m.edit(`Pong! Latency is ${m.createdTimestamp - message.createdTimestamp}ms. API Latency is ${Math.round(client.ping)}ms`);
    break

  case "pingstat":
    var statistics = require("./statistics")
    var Bot = new statistics.Bot(client)
    message.channel.send(statistics.view(Bot))
    break

  case "tip":
  case "send":
    // used to send a SYS or SPT tip to another user's tipbot account

    try {
      if (message.channel.name == undefined) {
        message.channel.send({embed: { color: c.FAIL_COL, description: ":rolling_eyes::point_up: Sorry but this command only works in the public channel."}});
        return
      }

      var myProfile = await db.getProfile(message.author.id)
      if (myProfile.restricted) {
         message.channel.send({embed: { color: c.FAIL_COL, description: "<@" + message.author.id + "> Sorry, your account has been restricted.  Please contact a member of the Syscoin Team."}})
         return
      }

      var receiver = message.mentions.users.first()
      if (!receiver) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Please specify a valid user and " + config.ctick + "/token amount to tip them.\nUse `" + prefix + "tip [user] [amount] [symbol/guid]` to continue.\nExample: `" + prefix + "tip @jagatoshi 100`"}})
        return
      }
      if (receiver.id == message.author.id) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "You cannot tip yourself."}})
        return
      }

      args[1] = new BigNumber(args[1])
      if (args[1].isNaN()) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Please ensure you have entered a valid number that is more than 0 for the tip amount."}})
        return
      }
      if (args[1].lt(config.tipMin)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "You must tip at least " + config.tipMin + " " + config.ctick + ". Too much dust will make it messy in here."}})
        return
      }

      let tipSuccess = await tips.tipUser(args, myProfile, await ifProfile(receiver.id), false, client, message)
      if (tipSuccess) {
        if (args[2] == undefined) {
          args[2] = "SYS"
        } else {
          args[2] = args[2].toUpperCase()
        }
        var actionStr = `Tip: ${args[2]}`
        let log = await db.createLog(message.author.id, actionStr, [receiver.id], args[1])
      }
    } catch (error) {
      console.log(error)
    }
    break

  case "reg":
  case "register":
    // registers a user with the tipbot
    try {
      if (message.channel.id == config.tipChannel
          || message.channel.id == config.tradeChannel
          || message.channel.id == config.auctionChannel
          || message.channel.id == config.missionChannel
          || message.channel.id == config.giveawayChannel) {

        let profileExists = await ifProfile(message.author.id)
        if (profileExists) {
            message.channel.send({embed: { color: c.FAIL_COL, description: "You already have a " + config.botname + " profile."}}).then(msg => {msg.delete({timeout: 15000}); message.delete({timeout: 15000})})
        } else {
         let newAddress = await HDSigner.getNewReceivingAddress()
         ls.set("receiveIndex", HDSigner.receivingIndex)
         console.log(ls.get("receiveIndex"))
         console.log("Issued receiving address " + newAddress + " to " + message.author.username + "(" + message.author.id + ")")

         let profile = db.createProfile(message.author.id, newAddress)
         let sysBalance = db.createBalance(message.author.id, "SYS", 0)
         client.users.fetch(message.author.id).then((userMsg) => {
           userMsg.send({embed: {color: c.SUCCESS_COL, description: '**Hello there <@' + message.author.id + '>!**\n\n' + ':grin: Greetings!  My name is **' + config.botname + '** and I am a bot in the ' + config.cname +
                      ` Discord server.  You are now registered and can access all of my commands. (Like **${prefix}help**)` +
                `\n\n:speech_balloon: All of my commands start with a ${prefix}\n` +
                '\n:atm: I\'m also a pseudo-wallet and you can deposit/withdraw ' + config.ctick + ' and Syscoin Platform Tokens (SPTs) with me!' +
                '\n\nDisclaimer: This tipbot was coded and is hosted by Syscoin community members. Choosing to use this bot is done at your own risk and the ' +
                'creators and hosters of this bot hold no responsibility if the unlikely loss of funds occurs. Do not send high value amounts of crypto to this bot.'}})
         })
         var actionStr = `Register: ${message.author.id} || Receive Index: ${HDSigner.receivingIndex} | Address: ${newAddress}`
         let log = await db.createLog(message.author.id, actionStr, [])
        }
      }
    } catch (error) {
      console.log(error)
    }
    break

  case "trade":
    // creates a trade between the user creating the trade and another
    // the tokens and the amount of each token to be traded must be specified
    if (message.channel.id == config.tradeChannel) {
      trades.createTrade(message, args)
    }
    break

  case "accept":
  case "tradeaccept":
    // accepts the trade with the given trade id
    if (message.channel.id == config.tradeChannel) {
      trades.acceptTrade(message, args, client)
    }
    break

  case "recent":
  case "tradesrecent":
    // retrieves and prints a list of the most recent trades
    // a specific token can be defined for this
    if (message.channel.id == config.tradeChannel) {
      trades.recentTrades(message, args, client)
    }
    break

  case "auction":
    // creates an auction for a specific token, time and reserve amount
    if (message.channel.id == config.auctionChannel) {
      auctions.createAuction(message, args)
    }
    break

  case "bid":
    // bids on a specific auction for the amount given
    if (message.channel.id == config.auctionChannel) {
      auctions.bid(message, args)
    }
    break

  case "cancel":
    // cancels a specific auction
    if (message.channel.id == config.auctionChannel) {
      auctions.cancelAuction(message, args)
    }

    // cancels the trade with the given trade id
    if (message.channel.id == config.tradeChannel) {
      trades.cancelTrade(message, args)
    }
    break

  case "endsoon":
    // retrieves and prints a list of the auctions that will be ending soon
    if (message.channel.id == config.auctionChannel) {
      auctions.endingSoon(message, client)
    }
    break

  case "show":
    // retrieves and prints the information of the auction with the given ID
    if (message.channel.id == config.auctionChannel) {
      auctions.showAuction(message, args, client)
    }
    break

  case "find":
    // retrieves and prints the information of auctions that include the given token
    if (message.channel.id == config.auctionChannel) {
      auctions.findAuctions(message, args, client)
    }
    break

  case "giveaway":
    // creates a giveaway that will randomly select a given number of users who react to the message
    // within a given time and will give the specified amount of SYS or SPTs to the selected winners

    if (!utils.checkAdminRole(message)) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "Sorry, you do not have the required permission."}});
      return
    }

    if (message.channel.id == config.giveawayChannel) {
      giveaways.createGiveaway(message, args, client)
    }
    break

  default:
  }
  } catch(err) {
    console.log(`Errors found:\n\`\`\`${err}\nAt ${err.stack}\`\`\``)
  }
})

client.login(config.discordKey)
