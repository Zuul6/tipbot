var exports = module.exports = {};

var TICK = ":white_check_mark:"
var CROSS = ":x:"

const com = require('./commandUsage.json')
const c = require('./c.json')
const config = require('./config.json')
var prefix = config.prefix

const base64 = require('base-64');

const BigNumber = require('bignumber.js')
BigNumber.config({ DECIMAL_PLACES: 8 })
BigNumber.config({ EXPONENTIAL_AT: 1e+9 })

const sjs = require('syscoinjs-lib')
const backendURL = config.blockURL

const db = require('./db.js')
const tips = require('./tips.js')
const utils = require('./utils.js')

var LocalStorage = require('node-localstorage').LocalStorage
localStorage = new LocalStorage('./ls')
var ls = require("./ls")

const Discord = require('discord.js')
const paginationEmbed = require('discord-paginationembed');
const { MessageEmbed } = require('discord.js');

function bidSort(a, b) {
  var amountA = new BigNumber(a.amount)
  var amountB = new BigNumber(b.amount)
  return amountA.minus(amountB)
}

function getHighestBid(bids) {
  var sortedBids = bids.sort(bidSort)
  if (sortedBids.length > 0) {
    return sortedBids[sortedBids.length - 1]
  } else {
    return {bidder: "", amount: 0}
  }
}

function auctionDateSort(a, b) {
  var timeA = new BigNumber(a.endTime.getTime())
  var timeB = new BigNumber(b.endTime.getTime())
  return timeA.minus(timeB)
}

function hasEnoughBalanceAuction(balance, amount, auction) {
  if (!balance || !auction) {
    return false
  }

  var highestBid = getHighestBid(auction.bids)
  var amountToBid = new BigNumber(amount)
  var balanceAmount = new BigNumber(balance.amount)
  var availableAmount

  if (highestBid.bidder === balance.userID) {
    var locked = new BigNumber(balance.lockedAmount)
    locked = locked.minus(highestBid.amount)
    availableAmount = balanceAmount.minus(locked)
  } else {
    availableAmount = balanceAmount.minus(balance.lockedAmount)
  }

  if (availableAmount.lt(amountToBid)) {
    return false
  }
  if (availableAmount.isNaN()) {
    console.log("Available amount is NaN. Probably issue with lockedAmount")
    console.log(balance)
    return false
  }
  return true
}

function splitToPages(auctionStrings, itemsPerPage) {
  var spliced = []
  while (auctionStrings.length > 0) {
    spliced.push(auctionStrings.splice(0, itemsPerPage))
  }

  var pages = []
  for (var i = 0; i < spliced.length; i++) {
    pages.push(new MessageEmbed)
    pages[i].description = ""
    for (var j = 0; j < spliced[i].length; j++) {
      pages[i].description += spliced[i][j]
    }
  }

  return pages
}

async function printAuctions(auctions, type, message, client) {
  try {
    var auctionString = ""
    var spt, tokenStr
    if (type === c.TOKEN) {
      spt = await utils.getSPT(auctions[0].token)
      tokenStr = await utils.getExpLink(auctions[0].token, c.TOKEN)
    }

    for (var i = auctions.length - 1; i >= 0; i--) {
      var a = auctions[i]
      var highestBid = getHighestBid(auctions[i].bids)

      if (type !== c.TOKEN) {
        spt = await sjs.utils.fetchBackendAsset(config.blockURL, a.token)
        tokenStr = await utils.getExpLink(a.token, c.TOKEN)
      }

      var highestBidAmount = new BigNumber(highestBid.amount)
      var reserve = new BigNumber(a.reservePrice)
      var tokenAmount = new BigNumber(a.tokenAmount)
      var tokenWhole = utils.toWholeUnit(tokenAmount, spt.decimals)
      var bidWhole = utils.toWholeUnit(highestBidAmount, 8)
      var reserveWhole = utils.toWholeUnit(reserve, 8)

      auctionString += `\n\nAuction ${a.auctionID} | End time: ${a.endTime}`
      auctionString += `\n\t${tokenWhole} ${tokenStr} | Bid: ${bidWhole} ${config.ctick} | Reserve price: ${reserveWhole} ${config.ctick}`
    }

    if (auctionString.length !== 0) {
      message.channel.send({embed: { color: c.SUCCESS_COL, description: auctionString }})
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: "No recent auctions to show." }})
    }
  } catch (error) {
    console.log(error)
  }
}

/**
* command: !auction [amount] [token] [timeAmount][m/h/d] [reserve]
* args
* 0 - amount, 1 - token, 2 - timeAmount with s/m/h/d, 3 - reserve
*/
exports.createAuction = async function(message, args) {

  try {
    var myProfile = await db.getProfile(message.author.id)

    if (!myProfile) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `You must be a registered user on the tipbot to perform this action. Use the !register command to register.`}})
      return
    }

    if (!utils.hasAllArgs(args, 4)) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Missing information. Usage: ${config.prefix}` + com.auction}})
      return
    }

    if (myProfile.restricted) {
       message.channel.send({embed: { color: c.FAIL_COL, description: "<@" + message.author.id + "> Sorry, your account has been restricted.  Please contact a member of the Syscoin Team."}})
       return
    }

    var time = {
        amount: new BigNumber(parseInt(args[2].substr(0, args[2].length - 1))),
        unit: args[2].substr(args[2].length - 1, args[2].length).toUpperCase()
    }

    var timeMilliSeconds = utils.convertToMillisecs(time.amount, time.unit)

    var amountStr = ["amount", "time amount", "reserve"]
    var amounts = [new BigNumber(args[0]), timeMilliSeconds, new BigNumber(args[3])]

    for (var i = 0; i < amounts.length; i++) {
      if (amounts[i].isNaN()) {
        message.channel.send({embed: { color: c.FAIL_COL, description: `The ${amountStr[i]} given is not a number.`}})
        return
      }

      if (!amounts[i].gt(0)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: `The ${amountStr[i]} given isn't more than 0.`}})
        return
      }
    }

    if (timeMilliSeconds.gt(utils.convertToMillisecs(config.maxAuctionTimeDays))) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `The max auction time is ${config.maxAuctionTimeDays} day(s). Try again with a lower auction time.`}})
      return
    }

    if (args[1] === "SYS") {
      message.channel.send({embed: { color: c.FAIL_COL, description: `You can't auction Syscoin...`}})
      return
    }

    var token = await utils.getSPT(args[1])

    if (!token) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Couldn't find the token: ${args[1]}. Please ensure you entered the symbol/GUID correctly.`}})
      return
    }

    if (utils.decimalCount(args[0]) > token.decimals) {
      if (token.decimals > 0) {
        message.channel.send({embed: { color: c.FAIL_COL, description: `You are trying to use too many decimals for the ${args[1]} amount. It can't have any more than ${token.decimals} decimals.`}})
      } else {
        message.channel.send({embed: { color: c.FAIL_COL, description: `${args[1]} is a non-divisible token. It can't have any decimals.`}})
      }
      return
    }

    var amountInSats = utils.toSats(amounts[0], token.decimals)
    var reserveInSats = utils.toSats(amounts[2], 8)

    if (amountInSats.isNaN() || reserveInSats.isNaN()) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "Error converting to sats. Please try again."}})
      return
    }

    var balance = await db.getBalance(message.author.id, token.assetGuid)
    var enoughBalance = utils.hasEnoughBalance(balance, amountInSats)

    if (!enoughBalance) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You don't have enough balance for this auction. Please deposit more and try again."}})
      return
    }

    // lock balance so user can't send the token somewhere else before the trade is completed
    var currentLocked = new BigNumber(balance.lockedAmount)
    var newLocked = currentLocked.plus(amountInSats)
    var updatedBalance = await db.editBalanceLocked(message.author.id, token.assetGuid, newLocked)

    var auctionIndex = ls.get("auctionIndex")
    if (!auctionIndex) {
      ls.set("auctionIndex", 0)
      auctionIndex = 0
    } else {
      auctionIndex = Number(auctionIndex) + 1
      ls.set("auctionIndex", auctionIndex)
    }
    console.log("Auction index: " + ls.get("auctionIndex"))

    var now = Date.now()
    var endDate = new Date(timeMilliSeconds.plus(now).toNumber())

    var auction = await db.createAuction(auctionIndex, message.author.id, token.assetGuid,
                                          amountInSats, reserveInSats, endDate)
    if (auction) {
      var tokenStr = await utils.getExpLink(token.assetGuid, c.TOKEN)

      if (!tokenStr) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Error finding token."}})
      }

      message.channel.send({embed: { color: c.SUCCESS_COL,
        description: `\nAuction ID: ${auctionIndex}` +
                      `\n<@${message.author.id}> is auctioning ${amounts[0]} ${tokenStr}` +
                      `\nReserve price: ${amounts[2]} ${config.ctick}` +
                      `\nAuction end time: ${endDate}` +
                      `\nAuction successfully created. Time to get bidding!`
      }})
    } else {
      // if auction isn't created for whatever reason then remove locked balance
      var revertedBalance = await db.editBalanceLocked(message.author.id, token.assetGuid, currentLocked)

      message.channel.send({embed: { color: c.FAIL_COL, description: "Error creating auction. Please try again."}})
      return
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: "Error creating auction. Please try again."}})
  }
}

// if no bids
exports.cancelAuction = async function(message, args) {
  try {
    var myProfile = await db.getProfile(message.author.id)

    if (!myProfile) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `You must be a registered user on the tipbot to perform this action. Use the !register command to register.`}})
      return
    }

    if (!utils.hasAllArgs(args, 1)) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Missing information. Usage: ${config.prefix}` + com.auctioncancel}})
      return
    }

    var auction = await db.getAuction(args[0])

    if (!auction) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "This auction doesn't exist."}})
      return
    }

    if (message.author.id !== auction.seller) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You didn't start this action so you can't end it."}})
      return
    }

    if (auction.bids.length > 0) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You can't end an auction if someone has already bid on it."}})
      return
    }

    var deletedAuction = await db.deleteAuction(args[0])

    if (deletedAuction) {
      message.channel.send({embed: { color: c.SUCCESS_COL, description: "Auction successfully cancelled and deleted."}})
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: "Error cancelling auction."}})
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: "Error cancelling auction."}})
  }
}

exports.bid = async function(message, args) {
  try {
    var myProfile = await db.getProfile(message.author.id)

    if (!myProfile) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `You must be a registered user on the tipbot to perform this action. Use the !register command to register.`}})
      return
    }

    if (!utils.hasAllArgs(args, 2)) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Missing information. Usage: ${config.prefix}` + com.bid}})
      return
    }

    var auction = await db.getAuction(args[0])

    if (!auction) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "This auction doesn't exist."}})
      return
    }

    if (auction.ended) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You can't bid on an auction that's already finished."}})
      return
    }

    if (message.author.id === auction.seller) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You can't bid on your own auction."}})
      return
    }

    var bidAmount = new BigNumber(args[1])

    var newBidSats = utils.toSats(bidAmount, 8)

    if (newBidSats.isNaN() || !newBidSats.gt(0)) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "Your bid amount is not a number or is not more than 0."}})
      return
    }

    var highestBid, highestBidAmount
    if (auction.bids.length > 0) {
      highestBid = getHighestBid(auction.bids)
      highestBidAmount = new BigNumber(highestBid.amount)

      if (newBidSats.lte(highestBidAmount)) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Your bid needs to be higher than the highest bid."}})
        return
      }
    }

    var balance = await db.getBalance(message.author.id, "SYS")
    var enoughBalance = hasEnoughBalanceAuction(balance, newBidSats, auction)

    if (!enoughBalance) {
      message.channel.send({embed: { color: c.FAIL_COL, description: "You don't have enough balance. Please deposit more to continue."}})
      return
    }

    var updatedAuction = await db.bidAuction(args[0], message.author.id, newBidSats)
    console.log(updatedAuction)

    if (updatedAuction) {
      // lock balance so user can't send the token somewhere else before the auction has ended,
      // or somone has outbid them
      var currentLocked = new BigNumber(balance.lockedAmount)
      var newLocked = currentLocked.plus(newBidSats)
      var updatedBalance = await db.editBalanceLocked(message.author.id, config.ctick, newLocked)

      // unlock the previous bidder's balance
      var sortedBids = updatedAuction.bids.sort(bidSort)
      if (sortedBids) {
        if (sortedBids[sortedBids.length - 1]) {
          var lastBid = sortedBids[sortedBids.length - 1]

          var lastBidderBal = await db.getBalance(lastBid.bidder, config.ctick)
          var lastLocked = new BigNumber(lastBidderBal.lockedAmount)
          var lastBidAmount = new BigNumber(lastBid.amount)
          var lastNewLocked = lastLocked.minus(lastBidAmount)
          var updatedLastBal = await db.editBalanceLocked(lastBid.bidder, config.ctick, lastNewLocked)
        }
      }

      var tokenStr = await utils.getExpLink(auction.token, c.TOKEN)

      if (!tokenStr) {
        message.channel.send({embed: { color: c.FAIL_COL, description: "Error finding token."}})
        return
      }

      var token = await sjs.utils.fetchBackendAsset(config.blockURL, auction.token)

      var reservePrice = new BigNumber(auction.reservePrice)
      var reserve = utils.toWholeUnit(reservePrice, 8)

      var reserveMet = CROSS
      if (newBidSats.gt(reservePrice)) {
        reserveMet = TICK
      }

      var tokenAmount = new BigNumber(auction.tokenAmount)

      message.channel.send({embed: { color: c.SUCCESS_COL,
        description: `\nAuction ID: ${auction.auctionID}` +
                      `\n<@${auction.seller}> auctioning ${utils.toWholeUnit(tokenAmount, token.decimals)} ${tokenStr}` +
                      `\nReserve price: ${reserve} ${config.ctick} | Met? ${reserveMet}` +
                      `\nAuction end time: ${auction.endTime}` +
                      `\nNew highest bid: ${args[1]} ${config.ctick} by <@${message.author.id}>`
      }})
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Error updating the auction ${auction.auctionID}.`}})
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: `Error updating the auction.`}})
  }
}

// limit is the time given in mins that an auction will be ending by
exports.getEndingSoon = async function getEndingSoon(limit) {
  try {
    var auctions = await db.getLiveAuctions()

    if (!auctions) {
      console.log("Error - cannot fetch live auctions to check end times")
    }

    var auctionsEnding = []

    for (var i = 0; i < auctions.length; i++) {
      var now = new BigNumber(Date.now())
      var end = new BigNumber(auctions[i].endTime.getTime())
      var diff = end.minus(now)

      var secsLeft = diff.dividedBy(1000)

      if (secsLeft.lte(limit)) {
        auctionsEnding.push(auctions[i])
      }
    }

    return auctionsEnding
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: `Error finding auctions.`}})
  }
}

exports.endAuction = async function(auctionID, client) {
  try {
    var channel = client.channels.cache.get(config.auctionChannel)
    var message = Array.from(await channel.messages.fetch({limit: 1}))[0][1]

    var auction = await db.getAuction(auctionID)

    if (!auction) {
      console.log(`Error: cannot find auction ${auctionID} to end it!`)
    }

    var highestBid = getHighestBid(auction.bids)
    var highestBidAmount = new BigNumber(highestBid.amount)
    var reserve = new BigNumber(auction.reservePrice)

    var reserveMet = CROSS
    if (highestBidAmount.gte(reserve)) {
      reserveMet = TICK
    }

    var spt = await sjs.utils.fetchBackendAsset(config.blockURL, auction.token)

    var tokenStr = await utils.getExpLink(auction.token, c.TOKEN)
    var tokenAmount = new BigNumber(auction.tokenAmount)
    var tokenWhole = utils.toWholeUnit(tokenAmount, spt.decimals)
    var bidWhole = utils.toWholeUnit(highestBidAmount, 8)
    var reserveWhole = utils.toWholeUnit(reserve, 8)

    if (highestBidAmount.lt(reserve)) {
      var endedAuction = await db.endAuction(auctionID)

      var bidStr, winStr
      if (highestBidAmount.gt(0)) {
        bidStr = `Highest bid: ${bidWhole} ${config.ctick} by <@${highestBid.bidder}>`
        winStr = "No winner as reserve price was not met"
      } else {
        bidStr = "No bids"
        winStr = "No winner"
      }


      if (endedAuction) {
        // unlock the amounts that were locked for the auction
        let oldBalanceSel = await db.getBalance(auction.seller, auction.token)
        let oldLockedSel = new BigNumber(oldBalanceSel.lockedAmount)
        let newLockedSel = oldLockedSel.minus(auction.tokenAmount)
        let newBalanceSel = await db.editBalanceLocked(auction.seller, auction.token, newLockedSel)

        if (highestBidAmount.gt(0)) {
          let oldBalanceBuy = await db.getBalance(highestBid.bidder, config.ctick)
          let oldLockedBuy = new BigNumber(oldBalanceBuy.lockedAmount)
          let newLockedBuy = oldLockedBuy.minus(highestBid.amount)
          let newBalanceBuy = await db.editBalanceLocked(highestBid.bidder, config.ctick, newLockedBuy)
        }

        channel.send({embed: { color: c.FAIL_COL,
        description: `\nAuction ${auction.auctionID} ended` +
                      `\n<@${auction.seller}> auctioning ${tokenWhole} ${tokenStr}` +
                      `\nReserve price: ${reserveWhole} ${config.ctick} | Met? ${reserveMet}` +
                      `\n${bidStr}` +
                      `\n${winStr}`
        }})
      } else {
        channel.send({embed: { color: c.FAIL_COL, description: `Error ending the auction ${auction.auctionID}.`}})
      }
      return
    }

    var tipInfo1 = [null, tokenWhole, auction.token]
    var tipInfo2 = [null, bidWhole, config.ctick]

    var sellerProf = await db.getProfile(auction.seller)
    var buyerProf = await db.getProfile(highestBid.bidder)

    let tipAtoB = await tips.tipUser(tipInfo1, sellerProf, buyerProf, c.AUCTION, client, message)

    if (tipAtoB) {
      let tipBtoA = await tips.tipUser(tipInfo2, buyerProf, sellerProf, c.AUCTION, client, message)

      if (!tipBtoA) {
        // if B to A fails, send user A back their cryptos
        let revertAtoB = await tips.tipUser(tipInfo1, buyerProf, sellerProf, c.GENERAL, client, message)
        channel.send({embed: { color: c.FAIL_COL, description: `Auction exchange failed. Reverting...`}})

        if (!revertAtoB) {
          // if the reversion fails restrict profile B so they can't move/withdraw the cryptos.
          // admin will need to correct.
          let restrictedB = await db.editProfile(buyerProf.userID, buyerProf.address, true)
          channel.send({embed: { color: c.FAIL_COL, description: `Reverting failed. <@${buyerProf.userID} you have been restricted. Please contact an admin.`}})
          return
        }
        return
      }

      var completedAuction = await db.completeAuction(auctionID, highestBidAmount, highestBid.bidder)
      var tokenAmount = new BigNumber(auction.tokenAmount)

      if (completedAuction) {
        // unlock the amounts that were locked for the auction
        let oldBalanceSel = await db.getBalance(auction.seller, auction.token)
        let oldLockedSel = new BigNumber(oldBalanceSel.lockedAmount)
        let newLockedSel = oldLockedSel.minus(auction.tokenAmount)
        let newBalanceSel = await db.editBalanceLocked(auction.seller, auction.token, newLockedSel)

        let oldBalanceBuy = await db.getBalance(highestBid.bidder, config.ctick)
        let oldLockedBuy = new BigNumber(oldBalanceBuy.lockedAmount)
        let newLockedBuy = oldLockedBuy.minus(highestBid.amount)
        let newBalanceBuy = await db.editBalanceLocked(highestBid.bidder, config.ctick, newLockedBuy)

        channel.send({embed: { color: c.SUCCESS_COL,
        description: `\nAuction ${auction.auctionID} ended!` +
                      `\n<@${auction.seller}> auctioning ${tokenWhole} ${tokenStr}` +
                      `\nReserve price: ${reserveWhole} ${config.ctick} | Met? ${reserveMet}` +
                      `\n:tada: <@${completedAuction.winner}> has won with a bid of ${bidWhole} ${config.ctick}! :tada:` +
                      `\nCongratulations!`
        }})
      }
    } else {
      channel.send({embed: { color: c.FAIL_COL, description: `Error completing the auction ${auction.auctionID}. First send failed.`}})
    }
  } catch (error) {
    console.log(error)
    channel.send({embed: { color: c.FAIL_COL, description: `Error completing the auction ${auction.auctionID}.`}})
  }
}

exports.endingSoon = async function(message, client) {
  try {
    // ending in 30 mins 1800 seconds
    var auctionsEnding = await exports.getEndingSoon(1800)

    if (auctionsEnding.length > 0) {
      printAuctions(auctionsEnding, c.GENERAL, message, client)
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: `No auctions found that are ending soon`}})
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: `Error finding auctions.`}})
  }
}

async function printAuction(auction, message, client) {
  try {
    var highestBid = getHighestBid(auction.bids)
    var highestBidAmount = new BigNumber(highestBid.amount)
    var reserve = new BigNumber(auction.reservePrice)

    var reserveMet = CROSS
    if (highestBidAmount.gte(reserve)) {
      reserveMet = TICK
    }

    var spt = await sjs.utils.fetchBackendAsset(config.blockURL, auction.token)

    var tokenStr = await utils.getExpLink(auction.token, c.TOKEN)
    var tokenAmount = new BigNumber(auction.tokenAmount)
    var tokenWhole = utils.toWholeUnit(tokenAmount, spt.decimals)
    var bidWhole = utils.toWholeUnit(highestBidAmount, 8)
    var reserveWhole = utils.toWholeUnit(reserve, 8)

    var seller = (await client.users.fetch(auction.seller)).username
    var endStr = `Auction end time: ${auction.endTime}`
    var winStr = `No winner`
    var auctioningStr = `is auctioning`
    var now = Date.now()
    if (now > auction.endTime.getTime()) {
      endStr = `Auction ended: ${auction.endTime}`
      if (auction.completed) {
        var winner = (await client.users.fetch(auction.winner)).username
        winStr = `:tada: ${winner} won with a bid of ${bidWhole} ${config.ctick} :tada:`
      }
      auctioningStr = `auctioned`
    } else {
      if (bidWhole.gt(0)) {
        var winner = (await client.users.fetch(highestBid.bidder)).username
        winStr = `${winner} has the highest bid of ${bidWhole} ${config.ctick}`
      } else {
        winStr = `No bids yet. Time to get bidding!`
      }
    }

    message.channel.send({embed: { color: c.SUCCESS_COL,
      description: `\nAuction ID: ${auction.auctionID}` +
                    `\n${seller} ${auctioningStr} ${auction.tokenAmount} ${tokenStr}` +
                    `\nReserve price: ${reserveWhole} ${config.ctick} | Met? ${reserveMet}` +
                    `\n${endStr}` +
                    `\n${winStr}`
    }})
  } catch (error) {
    console.log(error)
  }
}

exports.showAuction = async function(message, args, client) {
  try {
    if (!args[0]) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Auction ID is missing`}})
      return
    }

    var auction = await db.getAuction(args[0])

    if (auction) {
      printAuction(auction, message, client)
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Auction not found.`}})
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: `Error finding auction.`}})
  }

}

exports.findAuctions = async function(message, args, client) {
  try {
    if (!args[0]) {
      message.channel.send({embed: { color: c.FAIL_COL, description: `Please enter a token to search for`}})
      return
    }

    var token = await utils.getSPT(args[0])

    var auctions = await db.getTokenAuctions(token.assetGuid, 5)

    if (auctions.length > 0) {
      printAuctions(auctions, c.TOKEN, message, client)
    } else {
      message.channel.send({embed: { color: c.FAIL_COL, description: `No auctions found with that token`}})
    }
  } catch (error) {
    console.log(error)
    message.channel.send({embed: { color: c.FAIL_COL, description: `Error finding auctions.`}})
  }
}
